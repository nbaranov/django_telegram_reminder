# bot_handler.py

import os
import django
import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# Настройка Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'reminder_project.settings')
django.setup()

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    filename='Dj_Tg_reminder_bot.log',
    filemode='a',
    format='%(asctime)s %(levelname)s %(message)s'
)
logger = logging.getLogger(__name__)

from decouple import config

TELEGRAM_BOT_TOKEN = config('TELEGRAM_BOT_TOKEN')

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start."""
    chat_id = update.effective_message.chat_id # Используем .chat_id для ID чата
    chat_type = update.effective_message.chat.type # Получаем тип чата

    logger.info(f"Received /start command from chat_id: {chat_id}, chat_type: {chat_type}")

    if chat_type == 'private':
        # Отправляем сообщение только в личку
        await update.message.reply_text(
            f"Привет! Спасибо, что добавили меня. "
            f"Ваш Chat ID: <code>{chat_id}</code>\n"
            f"Добавьте его при создании пользователя на сайте.",
            parse_mode='HTML'
        )
    else:
        # Отправляем сообщение в группу/супергруппу/канал
        await update.message.reply_text(
            f"Привет! Я бот для напоминаний. "
            f"Мой Chat ID для этого чата: <code>{chat_id}</code>\n"
            f"Однако, для получения напоминаний, пожалуйста, напишите мне в личные сообщения команду /start.",
            parse_mode='HTML'
        )
        # Или просто игнорировать команду в группе:
        # logger.info(f"Ignoring /start command in non-private chat: {chat_id}")
        # return # (если решишь игнорировать)

def run_bot():
    """Запуск бота."""
    application = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start_command))

    logger.info("Bot started polling...")
    application.run_polling()

if __name__ == "__main__":
    run_bot()