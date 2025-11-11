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

import json

from .models import Reminder, Group, UserInGroup
from .forms import GroupForm, UserInGroupForm


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
 # POST для создания нового напоминания
    def post(self, request):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)

        # Валидация текста
        text = data.get('text', '').strip()
        if not text:
            return JsonResponse({'error': 'Text is required'}, status=400)

        # Валидация due_time
        due_time_str = data.get('due_time')
        if not due_time_str:
            return JsonResponse({'error': 'Due time is required'}, status=400)

        due_time = parse_datetime(due_time_str)
        if not due_time:
            return JsonResponse({'error': 'Invalid due_time format'}, status=400)

        # Валидация groups
        group_ids = [g['id'] for g in data.get('groups', [])]
        try:
            group_ids = [int(id) for id in group_ids]
        except (ValueError, TypeError):
            return JsonResponse({'error': 'Invalid group IDs'}, status=400)

        groups = Group.objects.filter(id__in=group_ids)
        if len(groups) != len(group_ids):
            return JsonResponse({'error': 'Some group IDs do not exist'}, status=400)

        # Создание напоминания
        reminder = Reminder.objects.create(
            text=text,
            due_time=due_time,
            is_completed=data.get('is_completed', False)
        )
        reminder.groups.set(groups)

        # Возвращаем созданный объект
        created_data = {
            'id': reminder.id,
            'text': reminder.text,
            'groups': [{'id': g.id, 'name': g.name} for g in reminder.groups.all()],
            'due_time': reminder.due_time.isoformat(),
            'is_completed': reminder.is_completed
        }
        return JsonResponse(created_data, status=201)

    def get(self, request):
        # Получаем параметры из GET-запроса
        page = request.GET.get('page', 1)
        page_size = request.GET.get('page_size', 20)

        try:
            page = int(page)
            page_size = int(page_size)
        except (ValueError, TypeError):
            return JsonResponse({'error': 'Invalid page or page_size'}, status=400)

        if page_size > 100:  # Ограничим максимальный размер страницы
            page_size = 100

        # Запрашиваем все напоминания, сортируем по ID (новые — первыми)
        reminders = Reminder.objects.all().order_by("-due_time", "-pk").prefetch_related('groups')

        # Создаём пагинатор
        paginator = Paginator(reminders, page_size)

        try:
            reminders_page = paginator.page(page)
        except Exception:
            return JsonResponse({'error': 'Invalid page number'}, status=400)

        # Формируем ответ
        data = {
            'reminders': [
                {
                    'id': r.id,
                    'text': r.text,
                    'groups': [{'id': g.id, 'name': g.name} for g in r.groups.all()],
                    'due_time': r.due_time.isoformat(),
                    'is_completed': r.is_completed
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

            # Обновляем поля
            reminder.text = data.get('text', reminder.text)
            # Обработка due_time: строку в datetime
            due_time_str = data.get('due_time')
            if due_time_str:
                from django.utils.dateparse import parse_datetime
                parsed_dt = parse_datetime(due_time_str)
                if parsed_dt:
                    from django.utils import timezone
                    # Предполагаем, что строка приходит в той же зоне, что и настройки Django, или в UTC
                    # Если нужна конкретная зона, добавь преобразование
                    reminder.due_time = parsed_dt
                else:
                    return JsonResponse({'error': 'Invalid due_time format'}, status=400)

            # Обновление ManyToMany требует особого подхода
            group_ids = [g['id'] for g in data.get('groups', [])]
            # Проверим, что group_ids - это список int
            try:
                group_ids = [int(id) for id in group_ids]
            except (ValueError, TypeError):
                return JsonResponse({'error': 'Invalid group IDs'}, status=400)

            # Получаем объекты Group
            from django.core.exceptions import ObjectDoesNotExist
            try:
                groups = Group.objects.filter(id__in=group_ids)
                # Проверяем, все ли ID существуют
                if len(groups) != len(group_ids):
                     return JsonResponse({'error': 'Some group IDs do not exist'}, status=400)
                reminder.groups.set(groups)
            except ValueError:
                return JsonResponse({'error': 'Invalid group IDs'}, status=400)

            reminder.save()

            # Возвращаем обновлённый объект
            updated_data = {
                'id': reminder.id,
                'text': reminder.text,
                'groups': [{'id': g.id, 'name': g.name} for g in reminder.groups.all()],
                'due_time': reminder.due_time.isoformat(),
                'is_completed': reminder.is_completed
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
