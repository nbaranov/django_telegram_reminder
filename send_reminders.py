import os
import django
import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from telegram import Bot
from telegram.error import Forbidden
from decouple import config

# Настройка Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'reminder_project.settings')
django.setup()

from reminders.models import Reminder, UserInGroup

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    filename='Dj_Tg_reminder.log',
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
        tasks = [send_reminder_to_user(tg_id, f"Reminder: {reminder_obj.text}") for tg_id in user_ids_list]
        if tasks:
            await asyncio.gather(*tasks)
        ids_to_update.append(reminder_obj.id)
    return ids_to_update

def send_due_reminders():
    now = datetime.now(tz=ZoneInfo("Europe/Moscow"))
    due_reminders = Reminder.objects.filter(due_time__lte=now, is_completed=False)

    reminders_user_data = []
    for reminder in due_reminders:
        user_ids = UserInGroup.objects.filter(
            group__in=reminder.groups.all()
        ).values_list('telegram_id', flat=True)
        user_ids_list = list(user_ids)
        reminders_user_data.append((reminder, user_ids_list))

    reminder_ids_to_update = asyncio.run(send_reminders_data_async(reminders_user_data))

    Reminder.objects.filter(id__in=reminder_ids_to_update).update(is_completed=True)
    logger.info(f"Marked {len(reminder_ids_to_update)} reminders as completed.")

if __name__ == "__main__":
    send_due_reminders()