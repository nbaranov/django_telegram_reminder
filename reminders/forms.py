from django import forms
from django_select2.forms import Select2MultipleWidget # Импортируем виджет
from .models import Reminder, Group, UserInGroup

class ReminderForm(forms.ModelForm):
    class Meta:
        model = Reminder
        fields = ['text', 'groups', 'due_time', 'is_completed']
        widgets = {
            'groups': Select2MultipleWidget, # Используем Select2 для мультивыбора
            'due_time': forms.DateTimeInput(attrs={'type': 'datetime-local'}), # Удобный ввод даты/времени
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Настройка виджета для Select2
        self.fields['groups'].widget.attrs.update({
            'data-placeholder': 'Select groups...',
            'data-minimum-input-length': 0,
        })

class GroupForm(forms.ModelForm):
    class Meta:
        model = Group
        fields = ['name']

class UserInGroupForm(forms.ModelForm):
    class Meta:
        model = UserInGroup
        fields = ['name', 'telegram_id', 'group']