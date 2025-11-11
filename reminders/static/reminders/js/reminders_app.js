document.addEventListener('DOMContentLoaded', () => {
    const data = window.REMINDERS_DATA;
    if (!data) {
        console.error('REMINDERS_DATA is not defined.');
        return;
    }

    const { createApp } = Vue;

    createApp({
        delimiters: ['[[', ']]'],
        data() {
            return {
                reminders: [],
                loading: true,
                error: null,
                editingReminder: null,
                editingGroups: [],
                groups: [],
                filterCompleted: 'all',
                filterText: '',
            };
        },
        computed: {
            filteredReminders() {
                let filtered = this.reminders;

                if (this.filterCompleted === 'pending') {
                    filtered = filtered.filter(r => !r.is_completed);
                } else if (this.filterCompleted === 'completed') {
                    filtered = filtered.filter(r => r.is_completed);
                }

                if (this.filterText) {
                    const lowerFilterText = this.filterText.toLowerCase();
                    filtered = filtered.filter(r => r.text.toLowerCase().includes(lowerFilterText));
                }

                return filtered;
            },
            statusLabels() {
                return {
                    pending: 'В ожидании',
                    completed: 'Выполнено'
                };
            },
            statusBadgeClass() {
                return (isCompleted) => isCompleted ? 'bg-success' : 'bg-warning';
            }
        },
        methods: {
            formatDate(isoString) {
                const date = new Date(isoString);
                return date.toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            },

            async loadReminders() {
                this.loading = true;
                this.error = null;
                try {
                    const response = await fetch(data.remindersApiEndpoint);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const result = await response.json();
                    // Формируем updateUrl и deleteUrl, используя обновлённые базы
                    this.reminders = result.reminders.map(rem => ({
                        ...rem,
                        updateUrl: `${data.updateReminderBaseUrl}${rem.id}/`,
                        // Для delete теперь URL будет /api/reminders/delete/{id}/
                        deleteUrl: `${data.deleteReminderBaseUrl}${rem.id}/`
                    }));
                } catch (err) {
                    console.error('Error loading reminders:', err);
                    this.error = 'Ошибка загрузки напоминаний';
                } finally {
                    this.loading = false;
                }
            },

            async loadGroups() {
                try {
                    const response = await fetch(data.groupsApiEndpoint);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    this.groups = await response.json();
                } catch (err) {
                    console.error('Error loading groups:', err);
                    this.error = 'Ошибка загрузки групп';
                }
            },

            async toggleCompleted(reminder) {
                const newStatus = !reminder.is_completed;
                reminder.is_completed = newStatus;

                try {
                    const response = await fetch(reminder.updateUrl, { // Используем URL из объекта напоминания
                        method: 'PATCH',
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ is_completed: newStatus })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    console.log(`Reminder ${reminder.id} marked as ${newStatus ? 'completed' : 'pending'}`);
                } catch (err) {
                    console.error('Error updating reminder status:', err);
                    reminder.is_completed = !newStatus; // Откат
                    this.error = 'Ошибка обновления статуса';
                }
            },

            startEditing(reminder) {
                this.editingReminder = { ...reminder };
                this.editingGroups = [...reminder.groups.map(g => g.id)];
            },

            cancelEditing() {
                this.editingReminder = null;
                this.editingGroups = [];
            },

            async saveEditing() {
                if (!this.editingReminder) return;

                this.editingReminder.groups = this.editingGroups.map(id => ({ id }));

                try {
                    const response = await fetch(this.editingReminder.updateUrl, { // Используем URL из объекта
                        method: 'PUT',
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(this.editingReminder)
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const updatedReminder = await response.json();
                    // Обновляем в списке
                    const index = this.reminders.findIndex(r => r.id === updatedReminder.id);
                    if (index !== -1) {
                        // Обновляем URLы для сохранения консистентности
                        updatedReminder.updateUrl = this.editingReminder.updateUrl;
                        updatedReminder.deleteUrl = this.editingReminder.deleteUrl;
                        this.reminders.splice(index, 1, updatedReminder);
                    }
                    this.cancelEditing();
                    console.log('Reminder updated successfully');
                } catch (err) {
                    console.error('Error saving reminder:', err);
                    this.error = 'Ошибка сохранения напоминания';
                }
            },

            async deleteReminder(reminder) { // Передаём весь объект напоминания
                if (!confirm('Вы уверены, что хотите удалить это напоминание?')) return;

                try {
                    const response = await fetch(reminder.deleteUrl, { // Используем URL из объекта
                        method: 'DELETE',
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    this.reminders = this.reminders.filter(r => r.id !== reminder.id);
                    console.log('Reminder deleted successfully');
                } catch (err) {
                    console.error('Error deleting reminder:', err);
                    this.error = 'Ошибка удаления напоминания';
                }
            },

            createReminder() {
                alert('Для создания напоминания используйте Django-форму.');
            }
        },

        async mounted() {
            await this.loadGroups();
            await this.loadReminders();
        },
    }).mount('#reminders-app');
});