from django.db import models

class Group(models.Model):
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class UserInGroup(models.Model):
    name = models.CharField(max_length=100)
    telegram_id = models.CharField(max_length=100, unique=True) # Telegram ID может быть длинным числом как строку
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='users')

    def __str__(self):
        return f"{self.name} ({self.telegram_id}) in {self.group.name}"

class Reminder(models.Model):
    text = models.TextField()
    groups = models.ManyToManyField('Group')
    due_time = models.DateTimeField()
    is_completed = models.BooleanField(default=False)
    is_sending = models.BooleanField(default=False)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    
    # Добавляем поля для периодической отправки
    repeat_interval_minutes = models.IntegerField(
        default=0,
        help_text="Интервал повторения в минутах (0 - без повторения)"
    )
    repeat_count = models.IntegerField(
        default=0,
        help_text="Счетчик отправок"
    )
    max_repeats = models.IntegerField(
        default=1,
        help_text="Максимальное количество отправок"
    )
    
    def __str__(self):
        return f"Reminder {self.id}: {self.text[:50]}"
    
    class Meta:
        ordering = ['-created_at']