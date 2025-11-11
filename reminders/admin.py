from django.contrib import admin
from .models import Group, UserInGroup, Reminder

@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ['id', 'name']
    search_fields = ['name']

@admin.register(UserInGroup)
class UserInGroupAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'telegram_id', 'group']
    list_filter = ['group']
    search_fields = ['name', 'telegram_id']

@admin.register(Reminder)
class ReminderAdmin(admin.ModelAdmin):
    list_display = ['id', 'text', 'due_time', 'is_completed']
    list_filter = ['is_completed', 'due_time', 'groups']
    filter_horizontal = ('groups',) # Для удобного выбора групп
    search_fields = ['text']