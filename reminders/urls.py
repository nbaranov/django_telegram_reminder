from django.urls import path
from . import views

urlpatterns = [
    # Напоминания
    path('', views.home, name='home'),
    path('reminders/', views.ReminderListView.as_view(), name='reminder_list'),

    # Группы
    path('groups/', views.GroupListView.as_view(), name='group_list'),
    path('groups/create/', views.GroupCreateView.as_view(), name='group_create'),
    path('groups/<int:pk>/update/', views.GroupUpdateView.as_view(), name='group_update'),
    path('groups/<int:pk>/delete/', views.GroupDeleteView.as_view(), name='group_delete'),

    # Пользователи в группе
    path('users/', views.UserInGroupListView.as_view(), name='useringroup_list'),
    path('users/create/', views.UserInGroupCreateView.as_view(), name='useringroup_create'),
    path('users/<int:pk>/update/', views.UserInGroupUpdateView.as_view(), name='useringroup_update'),
    path('users/<int:pk>/delete/', views.UserInGroupDeleteView.as_view(), name='useringroup_delete'),
    
    # Инструкция
    path('instruction/', views.instruction_view, name='instruction'),
    
    # API URLs
    path('api/reminders/', views.RemindersAPIView.as_view(), name='api_reminders'),
    path('api/groups/', views.GroupsAPIView.as_view(), name='api_groups'),
    path('api/reminders/<int:pk>/', views.ReminderUpdateView.as_view(), name='api_update_reminder'),
    path('api/reminders/delete/<int:pk>/', views.ReminderDeleteView.as_view(), name='api_delete_reminder'),
    path('api/reminders/send_due/', views.SendDueRemindersAPIView.as_view(), name='api_send_due_reminders'),
]