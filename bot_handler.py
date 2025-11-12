import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes
from decouple import config

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = config('TELEGRAM_BOT_TOKEN')

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start."""
    chat_id = update.effective_message.chat_id
    chat_type = update.effective_message.chat.type

    logger.info(f"Received /start command from chat_id: {chat_id}, chat_type: {chat_type}")

    if chat_type == 'private':
        await update.message.reply_text(
            f"Привет! Я бот для напоминаний.\n"
            f"Ваш Chat ID: <code>{chat_id}</code>\n"
            f"Добавьте его при создании пользователя на сайте.",
            parse_mode='HTML'
        )
    else:
        await update.message.reply_text(
            f"Привет! Я бот для напоминаний.\n"
            f"Мой Chat ID для этого чата: <code>{chat_id}</code>\n"
            f"Добавьте его при создании пользователя на сайте.",
            parse_mode='HTML'
        )

def run_bot():
    """Запуск бота."""
    application = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start_command))
    logger.info("Bot started polling...")
    application.run_polling()

if __name__ == "__main__":
    run_bot()