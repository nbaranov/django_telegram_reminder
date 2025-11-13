document.addEventListener('DOMContentLoaded', () => {
    const data = window.REMINDERS_DATA;
    if (!data) {
        console.error('REMINDERS_DATA is not defined.');
        return;
    }

    const { createApp } = Vue;

    //  Импортируем multiselect правильно
    const Multiselect = window['vue-multiselect'].default;
    // const Datepicker = window['DatePicker'].default;



    createApp({
        delimiters: ['[[', ']]'],
        components: {
            'multiselect': Multiselect,
            // 'Datepicker': Datepicker
        },
        data() {
            return {
                reminders: [],
                remindersBeingSent: [],
                reminderTimers: {},
                loading: true,
                refreshing: false,
                error: null,
                groups: [],
                filterCompleted: 'all',
                filterText: '',
                isFormActive: false,
                refreshInterval: null,
                filterGroup: null,
                editingForm: {
                    isActive: false,
                    mode: 'create', // или 'edit'
                    id: null,
                    text: '',
                    selectedGroups: [],
                    days: 0,
                    hours: 2,
                    minutes: 0,
                    timeMode: 'relative'
                },
                currentTime: new Date(),
                timerInterval: null,
                pagination: {
                    current_page: 1,
                    total_pages: 1,
                    total_count: 0,
                    has_next: false,
                    has_previous: false,
                    page_size: 20
                },
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

                if (this.filterGroup) {
                    filtered = filtered.filter(r => r.groups.some(g => g.id === this.filterGroup));
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

            async loadReminders(page = 1, isRefresh = false) {
                // Только при обычной загрузке показываем индикатор
                if (!isRefresh) {
                    this.loading = true;
                }
                this.error = null;
            
                try {
                    const response = await fetch(`${data.remindersApiEndpoint}?page=${page}&page_size=20`);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const result = await response.json();
            
                    this.pagination = result.pagination;
            
                    const freshMap = new Map(
                        result.reminders.map(rem => [
                            rem.id,
                            {
                                ...rem,
                                updateUrl: `${data.updateReminderBaseUrl}${rem.id}/`,
                                deleteUrl: `${data.deleteReminderBaseUrl}${rem.id}/`
                            }
                        ])
                    );
            
                    const updated = [];
                    for (const old of this.reminders) {
                        const fresh = freshMap.get(old.id);
                        if (fresh) {
                            Object.assign(old, {
                                ...old,
                                ...fresh,
                                sent_at: old.sent_at || fresh.sent_at,
                                api_call_attempted: old.api_call_attempted || fresh.api_call_attempted
                            });
                            updated.push(old);
                            freshMap.delete(old.id);
                        }
                    }
                    for (const fresh of freshMap.values()) {
                        updated.push(fresh);
                    }
                    updated.sort((a, b) => a.id - b.id);
            
                    this.reminders.splice(0, this.reminders.length, ...updated);
            
                    // Перезапуск таймеров
                    Object.values(this.reminderTimers).forEach(clearInterval);
                    this.reminderTimers = {};
                    this.reminders.forEach(reminder => {
                        if (!reminder.is_completed && !reminder.sent_at) {
                            this.startReminderTimer(reminder);
                        }
                    });
            
                } catch (err) {
                    console.error('Error loading reminders:', err);
                    // Показываем ошибку только при основной загрузке
                    if (!isRefresh) {
                        this.error = 'Ошибка загрузки напоминаний';
                    }
                    // При автообновлении можно не показывать — или записать в лог
                } finally {
                    if (!isRefresh) {
                        this.loading = false;
                    }
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

            startReminderTimer(reminder) {
                const timerId = setInterval(() => {
                    const now = new Date();
                    const due = new Date(reminder.due_time);
                    const diffMs = due - now;

                    if (diffMs <= 0) {
                        if (!this.remindersBeingSent.includes(reminder.id)) {
                            this.triggerReminderIfNeeded(reminder.id);
                        }
                        clearInterval(this.reminderTimers[reminder.id]);
                        delete this.reminderTimers[reminder.id];
                    }
                }, 1000);

                // Сохраняем ID таймера
                this.reminderTimers[reminder.id] = timerId;
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
                    // console.log(`Reminder ${reminder.id} marked as ${newStatus ? 'completed' : 'pending'}`);
                } catch (err) {
                    console.error('Error updating reminder status:', err);
                    reminder.is_completed = !newStatus; // Откат
                    this.error = 'Ошибка обновления статуса';
                }
            },

            showCreateForm() {
                this.isFormActive = true;
                this.editingForm = {
                    isActive: true,
                    mode: 'create',
                    id: null,
                    text: '',
                    selectedGroups: [],
                    days: 0,
                    hours: 2,
                    minutes: 0,
                    dueTime: '',
                    timeMode: 'relative'
                };
            },

            // Заполнить форму для редактирования
            startEditing(reminder) {
                // Определяем, относительное ли время
                const now = new Date();
                const due = new Date(reminder.due_time);
                const diffMs = due - now;
                let timeMode = 'absolute';
                let days = 0, hours = 0, minutes = 0;
                let dueTimeLocal = '';

                if (diffMs > 0 && diffMs <= 30 * 24 * 3600000) { // до 30 дней — считаем "относительным"
                    days = Math.floor(diffMs / 86400000);
                    hours = Math.floor((diffMs % 86400000) / 3600000);
                    minutes = Math.floor((diffMs % 3600000) / 60000);
                    timeMode = 'relative';
                } else {
                    // Преобразуем ISO в локальное время для input[type="datetime-local"]
                    dueTimeLocal = reminder.due_time.slice(0, 16); // YYYY-MM-DDTHH:mm
                    timeMode = 'absolute';
                }

                this.editingForm = {
                    isActive: true,
                    mode: 'edit',
                    id: reminder.id,
                    text: reminder.text,
                    selectedGroups: [...reminder.groups],
                    days,
                    hours,
                    minutes,
                    dueTime: dueTimeLocal,
                    timeMode
                };
            },

            // Отправка формы (создание или обновление)
            async submitForm() {
                this.isFormActive = false;
                if (!this.editingForm.text.trim()) {
                    this.error = 'Текст обязателен';
                    return;
                }

                const totalMs = (
                    this.editingForm.days * 86400000 +
                    this.editingForm.hours * 3600000 +
                    this.editingForm.minutes * 60000
                );

                if (totalMs <= 0) {
                    this.error = 'Укажите положительное время';
                    return;
                }

                const dueTime = new Date(Date.now() + totalMs).toISOString();

                // ✅ Подготовим payload
                const payload = {
                    text: this.editingForm.text,
                    groups: this.editingForm.selectedGroups.map(g => ({ id: g.id })),
                    due_time: dueTime,
                    // ✅ При редактировании сбрасываем статусы
                    is_completed: false,
                    sent_at: null, // или не передавать, если бэкенд сам сбрасывает
                };

                try {
                    let url, method;

                    if (this.editingForm.mode === 'create') {
                        url = data.remindersApiEndpoint;
                        method = 'POST';
                        // Для создания sent_at не нужно сбрасывать, т.к. его нет
                    } else {
                        url = `${data.updateReminderBaseUrl}${this.editingForm.id}/`;
                        method = 'PUT';
                        // ✅ При обновлении сбрасываем статусы
                    }

                    const response = await fetch(url, {
                        method: method,
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) throw new Error();

                    const result = await response.json();
                    result.updateUrl = `${data.updateReminderBaseUrl}${result.id}/`;
                    result.deleteUrl = `${data.deleteReminderBaseUrl}${result.id}/`;

                    if (this.editingForm.mode === 'create') {
                        this.reminders.push(result);
                    } else {
                        const index = this.reminders.findIndex(r => r.id === result.id);
                        if (index !== -1) {
                            // ✅ Обновляем локальный объект
                            this.reminders.splice(index, 1, result);
                        }
                    }

                    this.cancelForm(); 
                } catch (err) {
                    this.error = this.editingForm.mode === 'create'
                        ? 'Ошибка создания напоминания'
                        : 'Ошибка обновления напоминания';
                }
            },

            formatTimeLeft(isoString, reminderId) {
                const now = this.currentTime;
                const due = new Date(isoString);
                const diffMs = due - now;
        
                const reminder = this.reminders.find(r => r.id === reminderId);
                if (reminder && reminder.sent_at) {
                    return `${this.formatDate(reminder.sent_at)}`;
                }
        
                if (diffMs <= 0) {
                    return 'Отправляется';
                }
        
                const days = Math.floor(diffMs / 86400000);
                const hours = Math.floor((diffMs % 86400000) / 3600000);
                const minutes = Math.floor((diffMs % 3600000) / 60000);
                const seconds = Math.floor((diffMs % 60000) / 1000);
        
                if (days > 0) {
                    return `${days}д ${hours}ч ${minutes}м`;
                } else if (hours > 0) {
                    return `${hours}ч ${minutes}м ${seconds}с`;
                } else if (minutes > 0) {
                    return `${minutes}м ${seconds}с`;
                } else {
                    return `${seconds}с`;
                }
            },

            async triggerReminderIfNeeded(reminderId) {
                if (this.remindersBeingSent.includes(reminderId)) {
                    return;
                }

                this.remindersBeingSent.push(reminderId);

                try {
                    const response = await fetch(`${data.sendDueRemindersApiEndpoint}`, {
                        method: 'POST',
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ reminder_id: reminderId })
                    });

                    const result = await response.json();
                    if (result.status === 'sent') {
                        const reminder = this.reminders.find(r => r.id === reminderId);
                        if (reminder) {
                            reminder.is_completed = true;
                            reminder.sent_at = new Date().toISOString();
                        }
                    } else {
                        console.log("[triggerReminderIfNeeded]", result)
                    }
                } catch (err) {
                    console.error('Error triggering reminder:', err);
                    const index = this.remindersBeingSent.indexOf(reminderId);
                    if (index !== -1) {
                        this.remindersBeingSent.splice(index, 1);
                    }
                }
            },

            // Отмена формы
            cancelForm() {
                this.isFormActive = false;
                this.editingForm.isActive = false;
                // Не сбрасываем объект полностью — чтобы не сломать реактивность
                Object.assign(this.editingForm, {
                    mode: 'create',
                    id: null,
                    text: '',
                    selectedGroups: [],
                    days: 0,
                    hours: 0,
                    minutes: 0,
                    dueTime: '',
                    timeMode: 'relative'
                });
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

            editReminderViaForm(reminder) {
                this.isFormActive = true;
                const now = new Date();
                const due = new Date(reminder.due_time);
                const diffMs = due - now;
                let timeMode = 'absolute';
                let days = 0, hours = 0, minutes = 0;
                let dueTimeLocal = '';

                if (diffMs > 0 && diffMs <= 30 * 24 * 3600000) {
                    days = Math.floor(diffMs / 86400000);
                    hours = Math.floor((diffMs % 86400000) / 3600000);
                    minutes = Math.floor((diffMs % 3600000) / 60000);
                    timeMode = 'relative';
                } else {
                    dueTimeLocal = reminder.due_time.slice(0, 16);
                    timeMode = 'absolute';
                }

                this.editingForm = {
                    isActive: true,
                    mode: 'edit',
                    id: reminder.id,
                    text: reminder.text,
                    selectedGroups: [...reminder.groups],
                    days,
                    hours,
                    minutes,
                    dueTime: dueTimeLocal,
                    timeMode
                };
            },

            async goToPage(page) {
                if (page < 1 || page > this.pagination.total_pages) return;
                await this.loadReminders(page);
            },

            async goToNextPage() {
                if (this.pagination.has_next) {
                    await this.goToPage(this.pagination.current_page + 1);
                }
            },

            async goToPrevPage() {
                if (this.pagination.has_previous) {
                    await this.goToPage(this.pagination.current_page - 1);
                }
            },

            getVisiblePages() {
                const totalPages = this.pagination.total_pages;
                const currentPage = this.pagination.current_page;
                const delta = 2; // Сколько кнопок до и после текущей

                const range = [];
                const rangeWithDots = [];

                let l = Math.max(1, currentPage - delta);
                let r = Math.min(totalPages, currentPage + delta);

                for (let i = l; i <= r; i++) {
                    range.push(i);
                }

                if (currentPage - delta > 1) {
                    rangeWithDots.push(1);
                    if (currentPage - delta > 2) {
                        rangeWithDots.push('...');
                    }
                }

                rangeWithDots.push(...range);

                if (currentPage + delta < totalPages) {
                    if (currentPage + delta < totalPages - 1) {
                        rangeWithDots.push('...');
                    }
                    rangeWithDots.push(totalPages);
                }

                return rangeWithDots;
            },

        },

        async mounted() {
            await this.loadGroups();
            await this.loadReminders();

            this.timerInterval = setInterval(() => {
                this.currentTime = new Date(); // реактивное изменение
            }, 1000);

            this.refreshInterval = setInterval(async () => {
                if (!this.isFormActive) {
                    await this.loadReminders(this.pagination.current_page, true); 
                }
            }, 30000);
        },
        unmounted() {
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
            }
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            // Очищаем все таймеры обратного отсчёта (если остались)
            Object.values(this.reminderTimers).forEach(clearInterval);
        }
    }).mount('#reminders-app');
});