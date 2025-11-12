import os
import django
import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from telegram import Bot
from telegram.error import Forbidden
from decouple import config
from django.db import transaction

# Настройка Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'reminder_project.settings')
django.setup()

from reminders.models import Reminder, UserInGroup

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    filename=f'{config('LOG_FOLDER')}/Dj_Tg_reminder.log',
    filemode='a',
    format='%(asctime)s %(levelname)s %(message)s'
)
logger = logging.getLogger(__name__)

# Получаем токен из .env файла
TELEGRAM_BOT_TOKEN = config('TELEGRAM_BOT_TOKEN')
bot = Bot(token=TELEGRAM_BOT_TOKEN)

async def send_reminder_to_user(tg_id, message_text):
    try:
        await bot.send_message(chat_id=tg_id, text=message_text)
        logger.info(f"Sent reminder to {tg_id}")
    except Forbidden:
        logger.warning(f"User {tg_id} blocked the bot. Skipping.")
    except Exception as e:
        logger.error(f"Failed to send message to {tg_id}: {e}")

async def send_reminders_data_async(reminders_user_data):
    ids_to_update = []
    for reminder_obj, user_ids_list in reminders_user_data:
        logger.info(f"Processing reminder: {reminder_obj.text}")
        tasks = [send_reminder_to_user(tg_id, f"Вы просили напомнить о: {reminder_obj.text}") for tg_id in user_ids_list]
        if tasks:
            await asyncio.gather(*tasks)
        ids_to_update.append(reminder_obj.id)
    return ids_to_update

def send_due_reminders():
    now = datetime.now(tz=ZoneInfo("Europe/Moscow"))
    logger.info(f"Run at: {now}")

    # ✅ Атомарно помечаем напоминания как "в процессе отправки"
    with transaction.atomic():
        # Выбираем напоминания, которые:
        # - просрочены
        # - не завершены
        # - не помечены как "в процессе отправки"
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

        Reminder.objects.filter(id__in=[r.id for r in due_reminders]).update(is_sending=True)

    # Теперь обрабатываем отправку вне транзакции
    reminders_user_data = []
    for reminder in due_reminders:
        user_ids = UserInGroup.objects.filter(
            group__in=reminder.groups.all()
        ).values_list('telegram_id', flat=True)
        user_ids_list = list(user_ids)
        reminders_user_data.append((reminder, user_ids_list))

    if reminders_user_data:
        reminder_ids_to_update = asyncio.run(send_reminders_data_async(reminders_user_data))

        Reminder.objects.filter(id__in=reminder_ids_to_update).update(
            sent_at=now,
            is_completed=True,
            is_sending=False 
        )
        logger.info(f"Marked {len(reminder_ids_to_update)} reminders as sent and completed.")
    else:
        # Если не было напоминаний для отправки, просто сбрасываем is_sending
        Reminder.objects.filter(id__in=[r.id for r in due_reminders]).update(is_sending=False)
        logger.info("No user data to send.")
        
        
if __name__ == "__main__":
    logger.info(f"run senc_reminders")
    send_due_reminders()
    