import os
import django
import asyncio
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from telegram import Bot
from telegram.error import Forbidden
from decouple import config
from django.db import transaction
from django.utils import timezone

# Настройка Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'reminder_project.settings')
django.setup()

from reminders.models import Reminder, UserInGroup

# Настройка логирования
def setup_logging():
    handler = RotatingFileHandler(
        filename=f'{config("LOG_FOLDER")}/Dj_Tg_reminder.log',
        maxBytes=1 * 1024 * 1024,
        backupCount=1,  
        encoding='utf-8'
    )

    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    handler.setFormatter(formatter)

    logger = logging.getLogger()
    for h in logger.handlers[:]:
        logger.removeHandler(h)
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    return logger

logger = setup_logging()

TELEGRAM_BOT_TOKEN = config('TELEGRAM_BOT_TOKEN')
TELEGRAM_PROXY_URL = config('TELEGRAM_PROXY_URL')  

def create_bot_with_proxy():
    """Создает бота с прокси для рассылки"""
    if TELEGRAM_PROXY_URL:
        os.environ['HTTP_PROXY'] = TELEGRAM_PROXY_URL
        os.environ['HTTPS_PROXY'] = TELEGRAM_PROXY_URL
        os.environ['http_proxy'] = TELEGRAM_PROXY_URL
        os.environ['https_proxy'] = TELEGRAM_PROXY_URL
        
    logger.info(f"Reminder bot created {'with proxy' if TELEGRAM_PROXY_URL else ''}")
    return Bot(token=TELEGRAM_BOT_TOKEN)

async def send_reminder_to_user(bot, tg_id, message_text):
    """Асинхронная функция отправки напоминания пользователю"""
    try:
        await bot.send_message(chat_id=tg_id, text=message_text)
        logger.info(f"Sent reminder to {tg_id}")
        return True
    except Forbidden:
        logger.warning(f"User {tg_id} blocked the bot. Skipping.")
        return False
    except Exception as e:
        logger.error(f"Failed to send message to {tg_id}: {e}")
        return False

async def send_reminders_batch(bot, reminders_user_data):
    """Асинхронная отправка батча напоминаний"""
    successful_reminders = []
    
    for reminder_obj, user_ids_list in reminders_user_data:
        logger.info(f"Processing reminder: {reminder_obj.text}")
        
        tasks = [
            send_reminder_to_user(bot, tg_id, f"Вы просили напомнить:\n{reminder_obj.text}") 
            for tg_id in user_ids_list
        ]
        
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            successful_sends = sum(1 for r in results if r is True)
            if successful_sends > 0:
                successful_reminders.append(reminder_obj.id)
                logger.info(f"Reminder {reminder_obj.id} successfully sent to {successful_sends} users")
            else:
                logger.warning(f"Reminder {reminder_obj.id} failed to send to all users")
    
    return successful_reminders

def send_due_reminders():
    now = timezone.now()
    logger.info(f"Run at: {now}")

    with transaction.atomic():
        due_reminders = list(
            Reminder.objects.select_for_update()
            .filter(
                due_time__lte=now,
                is_completed=False,
                is_sending=False
            )
        )

        if not due_reminders:
            logger.info("No due reminders to send.")
            return

        ids_to_send = [r.id for r in due_reminders]
        # Помечаем как отправляющиеся
        Reminder.objects.filter(id__in=ids_to_send).update(is_sending=True)

    reminders_user_data = []
    reminder_objects_map = {}
    
    for reminder in due_reminders:
        user_ids = UserInGroup.objects.filter(
            group__in=reminder.groups.all()
        ).values_list('telegram_id', flat=True)
        user_ids_list = list(user_ids)
        if user_ids_list:
            reminders_user_data.append((reminder, user_ids_list))
            reminder_objects_map[reminder.id] = reminder

    if not reminders_user_data:
        # Если нет пользователей, сбрасываем флаги
        Reminder.objects.filter(id__in=ids_to_send).update(is_sending=False)
        logger.info("No users found for any of the due reminders. Skipping send.")
        return

    bot = create_bot_with_proxy()

    try:
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        successful_ids = loop.run_until_complete(send_reminders_batch(bot, reminders_user_data))
        
        # Обрабатываем успешные отправки с учетом повторений
        for reminder_id in successful_ids:
            reminder = reminder_objects_map.get(reminder_id)
            if not reminder:
                continue
                
            with transaction.atomic():
                # Блокируем запись для обновления
                reminder = Reminder.objects.select_for_update().get(id=reminder_id)
                
                # Увеличиваем счетчик отправок
                reminder.repeat_count += 1
                reminder.sent_at = now
                
                # Проверяем, нужно ли повторять
                if (reminder.repeat_interval_minutes > 0 and 
                    reminder.repeat_count < reminder.max_repeats):
                    # Устанавливаем следующее время отправки
                    next_due_time = now + timedelta(minutes=reminder.repeat_interval_minutes)
                    reminder.due_time = next_due_time
                    reminder.is_sending = False  # Сбрасываем флаг отправки
                    reminder.is_completed = False
                    logger.info(f"Reminder {reminder_id} scheduled for repeat at {next_due_time}. Count: {reminder.repeat_count}/{reminder.max_repeats}")
                else:
                    # Достигли максимального количества повторов
                    reminder.is_completed = True
                    reminder.is_sending = False  # Сбрасываем флаг отправки
                    logger.info(f"Reminder {reminder_id} marked as completed. Total sends: {reminder.repeat_count}")
                
                reminder.save()
        
        # Сбрасываем флаг у тех, что не удалось отправить
        failed_ids = list(set(ids_to_send) - set(successful_ids))
        if failed_ids:
            Reminder.objects.filter(id__in=failed_ids).update(is_sending=False)
            logger.warning(f"Reset is_sending flag for {len(failed_ids)} failed reminders")
            
    except Exception as e:
        logger.error(f"Critical error during sending: {e}", exc_info=True)
        # При любой ошибке сбрасываем флаги у всех
        Reminder.objects.filter(id__in=ids_to_send).update(is_sending=False)
        
        
if __name__ == "__main__":
    logger.info(f"run send_reminders with proxy")
    send_due_reminders()