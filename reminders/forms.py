from django import forms
from django_select2.forms import Select2MultipleWidget # Импортируем виджет
from .models import Reminder, Group, UserInGroup


class GroupForm(forms.ModelForm):
    class Meta:
        model = Group
        fields = ['name']
        labels = {'name': 'Имя'}

class UserInGroupForm(forms.ModelForm):
    class Meta:
        model = UserInGroup
        fields = ['name', 'telegram_id', 'group']
        labels = {'name': 'Имя', 'telegram_id': 'Telegram ID', 'group': 'Группа'}