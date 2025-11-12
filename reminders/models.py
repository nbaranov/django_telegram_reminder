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
    groups = models.ManyToManyField(Group, related_name='reminders')
    due_time = models.DateTimeField()
    is_completed = models.BooleanField(default=False)
    is_sending = models.BooleanField(default=False)
    sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        status = "Completed" if self.is_completed else "Pending"
        return f"[{status}] {self.text} (Due: {self.due_time})"