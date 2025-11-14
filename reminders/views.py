from django.shortcuts import render, get_object_or_404, redirect
from django.contrib import messages
from django.urls import reverse_lazy
from django.views.generic import ListView, CreateView, UpdateView, DeleteView
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.views import View
from django.views.generic import TemplateView
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from django.core.exceptions import ValidationError
from django.core.paginator import Paginator
from django.utils import timezone
from datetime import timedelta
from django.db import transaction

import asyncio
import json
import logging
from logging.handlers import RotatingFileHandler
from decouple import config
from datetime import datetime
from zoneinfo import ZoneInfo

from .models import Reminder, Group, UserInGroup
from .forms import GroupForm, UserInGroupForm
from send_reminders import create_bot_with_proxy, send_reminders_batch

# Настройка логирования
logger = logging.getLogger(__name__)

# Инструкция
def instruction_view(request):
    return render(request, 'reminders/instruction.html')

# Представления для напоминаний
class ReminderListView(TemplateView):
    template_name = 'reminders/reminder_list_vue.html'

# Представления для групп
class GroupListView(ListView):
    model = Group
    template_name = 'reminders/group_list.html'
    context_object_name = 'groups'

class GroupCreateView(CreateView):
    model = Group
    form_class = GroupForm
    template_name = 'reminders/group_form.html'
    success_url = reverse_lazy('group_list')

class GroupUpdateView(UpdateView):
    model = Group
    form_class = GroupForm
    template_name = 'reminders/group_form.html'
    success_url = reverse_lazy('group_list')

class GroupDeleteView(DeleteView):
    model = Group
    template_name = 'reminders/group_confirm_delete.html'
    success_url = reverse_lazy('group_list')

# Представления для пользователей в группе
class UserInGroupListView(ListView):
    model = UserInGroup
    template_name = 'reminders/useringroup_list.html'
    context_object_name = 'users'

class UserInGroupCreateView(CreateView):
    model = UserInGroup
    form_class = UserInGroupForm
    template_name = 'reminders/useringroup_form.html'
    success_url = reverse_lazy('useringroup_list')

class UserInGroupUpdateView(UpdateView):
    model = UserInGroup
    form_class = UserInGroupForm
    template_name = 'reminders/useringroup_form.html'
    success_url = reverse_lazy('useringroup_list')

class UserInGroupDeleteView(DeleteView):
    model = UserInGroup
    template_name = 'reminders/useringroup_confirm_delete.html'
    success_url = reverse_lazy('useringroup_list')

# Главная страница (например, список напоминаний)
def home(request):
    return redirect('reminder_list') # Перенаправляем на список напоминаний



# API Views
@method_decorator(csrf_exempt, name='dispatch')
class RemindersAPIView(View):
    def post(self, request):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)

        text = data.get('text', '').strip()
        if not text:
            return JsonResponse({'error': 'Text is required'}, status=400)

        due_time_str = data.get('due_time')
        if not due_time_str:
            return JsonResponse({'error': 'Due time is required'}, status=400)

        due_time = parse_datetime(due_time_str)
        if not due_time:
            return JsonResponse({'error': 'Invalid due_time format'}, status=400)

        group_ids = [g['id'] for g in data.get('groups', [])]
        try:
            group_ids = [int(id) for id in group_ids]
        except (ValueError, TypeError):
            return JsonResponse({'error': 'Invalid group IDs'}, status=400)

        groups = Group.objects.filter(id__in=group_ids)
        if len(groups) != len(group_ids):
            return JsonResponse({'error': 'Some group IDs do not exist'}, status=400)

        # Создание напоминания с новыми полями
        logger.info(f"{data=}")
        reminder = Reminder.objects.create(
            text=text,
            due_time=due_time,
            is_completed=data.get('is_completed', False),
            repeat_interval_minutes=data.get('repeat_interval_minutes', 0),
            max_repeats=data.get('max_repeats', 1)
        )
        reminder.groups.set(groups)

        created_data = {
            'id': reminder.id,
            'text': reminder.text,
            'groups': [{'id': g.id, 'name': g.name} for g in reminder.groups.all()],
            'due_time': reminder.due_time.isoformat(),
            'is_completed': reminder.is_completed,
            'is_sending': reminder.is_sending,
            'sent_at': reminder.sent_at,
            'repeat_interval_minutes': reminder.repeat_interval_minutes,
            'repeat_count': reminder.repeat_count,
            'max_repeats': reminder.max_repeats,
        }
        return JsonResponse(created_data, status=201)

    def get(self, request):
        page = request.GET.get('page', 1)
        page_size = request.GET.get('page_size', 20)

        try:
            page = int(page)
            page_size = int(page_size)
        except (ValueError, TypeError):
            return JsonResponse({'error': 'Invalid page or page_size'}, status=400)

        if page_size > 100:
            page_size = 100

        reminders = Reminder.objects.all().prefetch_related('groups')

        paginator = Paginator(reminders, page_size)

        try:
            reminders_page = paginator.page(page)
        except Exception:
            return JsonResponse({'error': 'Invalid page number'}, status=400)

        data = {
            'reminders': [
                {
                    'id': r.id,
                    'text': r.text,
                    'groups': [{'id': g.id, 'name': g.name} for g in r.groups.all()],
                    'due_time': r.due_time.isoformat(),
                    'is_completed': r.is_completed,
                    'is_sending': r.is_sending,
                    'sent_at': r.sent_at,
                    'repeat_interval_minutes': r.repeat_interval_minutes,
                    'repeat_count': r.repeat_count,
                    'max_repeats': r.max_repeats,
                }
                for r in reminders_page
            ],
            'pagination': {
                'current_page': reminders_page.number,
                'total_pages': paginator.num_pages,
                'total_count': paginator.count,
                'has_next': reminders_page.has_next(),
                'has_previous': reminders_page.has_previous(),
                'page_size': page_size
            }
        }
        return JsonResponse(data)

class GroupsAPIView(View):
    def get(self, request):
        groups = Group.objects.all()
        data = [{'id': g.id, 'name': g.name} for g in groups]
        return JsonResponse(data, safe=False)

# Для обновления статуса и редактирования
@method_decorator(csrf_exempt, name='dispatch')
class ReminderUpdateView(View):
    def patch(self, request, pk): # PATCH для изменения статуса
        reminder = get_object_or_404(Reminder, pk=pk)
        try:
            data = json.loads(request.body)
            if 'is_completed' in data:
                reminder.is_completed = data['is_completed']
                reminder.sent_at = timezone.now()
                logger.info(f"Reminder with ID {pk} was chnged is_completed to: {reminder.is_completed}")
                reminder.save()
                return JsonResponse({'success': True, 'reminder': {
                    'id': reminder.id,
                    'is_completed': reminder.is_completed
                }})
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)

        return JsonResponse({'error': 'No valid field to update'}, status=400)

    def put(self, request, pk): # PUT для полного редактирования
        reminder = get_object_or_404(Reminder, pk=pk)
        try:
            data = json.loads(request.body)

            # Обновляем основные поля
            reminder.text = data.get('text', reminder.text)
            
            # Обработка due_time: строку в datetime
            due_time_str = data.get('due_time')
            if due_time_str:
                parsed_dt = parse_datetime(due_time_str)
                if parsed_dt:
                    reminder.due_time = parsed_dt
                else:
                    return JsonResponse({'error': 'Invalid due_time format'}, status=400)

            # Обновление ManyToMany
            group_ids = [g['id'] for g in data.get('groups', [])]
            try:
                group_ids = [int(id) for id in group_ids]
            except (ValueError, TypeError):
                return JsonResponse({'error': 'Invalid group IDs'}, status=400)

            groups = Group.objects.filter(id__in=group_ids)
            if len(groups) != len(group_ids):
                return JsonResponse({'error': 'Some group IDs do not exist'}, status=400)
            reminder.groups.set(groups)

            # Обработка полей повторения
            if 'repeat_interval_minutes' in data:
                reminder.repeat_interval_minutes = data['repeat_interval_minutes']
            
            if 'max_repeats' in data:
                reminder.max_repeats = data['max_repeats']
            
            # Сбрасываем счетчик повторений при изменении настроек повторения
            if 'repeat_interval_minutes' in data or 'max_repeats' in data:
                reminder.repeat_count = 0
                logger.info(f"Reset repeat_count for reminder {pk} due to interval/max_repeats change")

            # Обработка статусов
            if 'is_completed' in data:
                reminder.is_completed = data['is_completed']
                
            if 'sent_at' in data:
                sent_at_val = data['sent_at']
                if sent_at_val:
                    parsed_sent_at = parse_datetime(sent_at_val)
                    if parsed_sent_at:
                        reminder.sent_at = parsed_sent_at
                    else:
                        return JsonResponse({'error': 'Invalid sent_at format'}, status=400)
                else:
                    reminder.sent_at = None

            reminder.save()

            # Возвращаем обновлённый объект с новыми полями
            updated_data = {
                'id': reminder.id,
                'text': reminder.text,
                'groups': [{'id': g.id, 'name': g.name} for g in reminder.groups.all()],
                'due_time': reminder.due_time.isoformat(),
                'is_completed': reminder.is_completed,
                'sent_at': reminder.sent_at.isoformat() if reminder.sent_at else None,
                'repeat_interval_minutes': reminder.repeat_interval_minutes,
                'repeat_count': reminder.repeat_count,
                'max_repeats': reminder.max_repeats,
            }
            return JsonResponse(updated_data)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

# Для удаления
@method_decorator(csrf_exempt, name='dispatch')
class ReminderDeleteView(View):
    def delete(self, request, pk):
        reminder = get_object_or_404(Reminder, pk=pk)
        reminder.delete()
        return JsonResponse({'success': True})


@method_decorator(csrf_exempt, name='dispatch')
class SendDueRemindersAPIView(View):
    def post(self, request):
        try:
            data = json.loads(request.body.decode('utf-8'))
            reminder_id = data.get('reminder_id')
            logger.info(f"I got and start sending for reminder: {reminder_id}")
            
            if not reminder_id:
                return JsonResponse({'error': 'reminder_id is required'}, status=400)

            now = timezone.now()

            with transaction.atomic():
                try:
                    reminder = Reminder.objects.select_for_update().get(id=reminder_id)
                except Reminder.DoesNotExist:
                    logger.error(f"Reminder with id {reminder_id} not found in API.")
                    return JsonResponse({'error': 'Reminder not found'}, status=404)

                if reminder.is_completed:
                    logger.info(f"Reminder {reminder_id} already completed.")
                    return JsonResponse({'status': 'already_completed'})

                if reminder.is_sending:
                    logger.info(f"Reminder {reminder_id} already being sent.")
                    return JsonResponse({'status': 'already_sending'})

                cushion = timedelta(seconds=10)
                if reminder.due_time > now + cushion:
                    logger.info(f"Reminder {reminder_id} is not due yet (due: {reminder.due_time}, now: {now}), cushion: {cushion}")
                    return JsonResponse({'status': 'not_due_yet'})

                logger.info(f"Marking reminder {reminder_id} as sending.")
                reminder.is_sending = True
                reminder.save()

            user_ids = UserInGroup.objects.filter(
                group__in=reminder.groups.all()
            ).values_list('telegram_id', flat=True)
            user_ids_list = list(user_ids)

            if not user_ids_list:
                logger.info(f"No users found for reminder {reminder_id}, skipping send.")
                reminder.is_sending = False
                reminder.save()
                return JsonResponse({'status': 'no_users'})

            logger.info(f"Sending reminder {reminder_id} to {len(user_ids_list)} users.")
            
            bot = create_bot_with_proxy()
            
            try:
                successful_ids = asyncio.run(send_reminders_batch(bot, [(reminder, user_ids_list)]))
                
                if reminder.id in successful_ids:
                    # Обновляем напоминание с учетом повторений
                    with transaction.atomic():
                        reminder = Reminder.objects.select_for_update().get(id=reminder_id)
                        reminder.repeat_count += 1
                        reminder.sent_at = now
                        
                        # Проверяем, нужно ли повторять
                        if (reminder.repeat_interval_minutes > 0 and 
                            reminder.repeat_count < reminder.max_repeats):
                            # Устанавливаем следующее время отправки
                            next_due_time = now + timedelta(minutes=reminder.repeat_interval_minutes)
                            
                            reminder.due_time = next_due_time
                            reminder.is_sending = False
                            reminder.is_completed = False
                            reminder.save()
                            
                            # Возвращаем обновленные данные
                            updated_data = {
                                'id': reminder.id,
                                'due_time': reminder.due_time.isoformat(),
                                'is_completed': reminder.is_completed,
                                'is_sending': reminder.is_sending,
                                'repeat_count': reminder.repeat_count,
                                'sent_at': reminder.sent_at.isoformat() if reminder.sent_at else None,
                            }
                            logger.info(f"Reminder {reminder_id} scheduled for repeat at {next_due_time}. Count: {reminder.repeat_count}/{reminder.max_repeats}")
                            return JsonResponse({'status': 'repeated', 'reminder': updated_data})
                        else:
                            # Достигли максимального количества повторов
                            reminder.is_completed = True
                            reminder.is_sending = False
                            reminder.save()
                            logger.info(f"Reminder {reminder_id} marked as sent and completed. Total sends: {reminder.repeat_count}")
                            return JsonResponse({'status': 'sent'})
                else:
                    # Сбрасываем флаг отправки при неудаче
                    reminder.is_sending = False
                    reminder.save()
                    logger.error(f"Reminder {reminder_id} failed to send to all users")
                    return JsonResponse({'error': 'Failed to send to any user'}, status=500)
                    
            except Exception as e:
                logger.error(f"Error sending reminder {reminder_id}: {e}")
                # При любой ошибке сбрасываем флаг отправки
                reminder.is_sending = False
                reminder.save()
                return JsonResponse({'error': str(e)}, status=500)

        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error in SendDueRemindersAPIView: {e}")
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.error(f"Error in SendDueRemindersAPIView: {e}", exc_info=True)
            return JsonResponse({'error': str(e)}, status=500)