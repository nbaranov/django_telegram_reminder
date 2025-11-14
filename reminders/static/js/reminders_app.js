document.addEventListener('DOMContentLoaded', () => {
    const data = window.REMINDERS_DATA;
    if (!data) {
        console.error('REMINDERS_DATA is not defined.');
        return;
    }

    const { createApp } = Vue;
    const Multiselect = window['vue-multiselect'].default;

    createApp({
        delimiters: ['[[', ']]'],
        components: {
            'multiselect': Multiselect,
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
                    mode: 'create',
                    id: null,
                    text: '',
                    selectedGroups: [],
                    days: 0,
                    hours: 0,
                    minutes: 5,
                    timeMode: 'relative',
                    absoluteTime: this.getCurrentDateTime(),
                    repeatInterval: 0,
                    maxRepeats: 1
                },
                formSubmitted: false,
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
                storageKeys: {
                    filterGroup: 'reminders_filterGroup',
                    filterCompleted: 'reminders_filterCompleted',
                    lastGroups: 'reminders_lastGroups',
                    formSettings: 'reminders_formSettings'
                },
                initialLoadComplete: false
            };
        },
        computed: {
            filteredReminders() {
                if (!this.initialLoadComplete) {
                    return [];
                }
                
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

                return this.sortReminders(filtered);
            },
            repeatIntervalOptions() {
                return [
                    { value: 0, label: 'Без повторения' },
                    { value: 1, label: 'Каждую минуту' },
                    { value: 5, label: 'Каждые 5 минут' },
                    { value: 10, label: 'Каждые 10 минут' },
                    { value: 15, label: 'Каждые 15 минут' },
                    { value: 30, label: 'Каждые 30 минут' },
                    { value: 60, label: 'Каждый час' },
                    { value: 120, label: 'Каждые 2 часа' },
                    { value: 1440, label: 'Каждый день' },
                    { value: 10080, label: 'Раз в неделю' }
                ];
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
        watch: {
            filterGroup(newVal) {
                this.saveToStorage();
                if (this.initialLoadComplete) {
                    this.loadReminders(this.pagination.current_page);
                }
            },
            filterCompleted(newVal) {
                this.saveToStorage();
            },
            'editingForm.repeatInterval'(newVal) {
                if (newVal === 0) {
                    this.editingForm.maxRepeats = 1;
                }
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

            getCurrentDateTime() {
                const now = new Date();
                const timezoneOffset = now.getTimezoneOffset() * 60000;
                const localDate = new Date(now.getTime() - timezoneOffset);
                return localDate.toISOString().slice(0, 16);
            },

            switchTimeMode(mode) {
                this.editingForm.timeMode = mode;
                if (mode === 'absolute') {
                    this.editingForm.absoluteTime = this.getCurrentDateTime();
                }
            },

            utcToLocal(utcString) {
                if (!utcString) return this.getCurrentDateTime();
                
                const date = new Date(utcString);
                const timezoneOffset = date.getTimezoneOffset() * 60000;
                const localDate = new Date(date.getTime() - timezoneOffset);
                return localDate.toISOString().slice(0, 16);
            },

            loadFromStorage() {
                // Загружаем фильтр группы
                const savedFilterGroup = localStorage.getItem(this.storageKeys.filterGroup);
                if (savedFilterGroup) {
                    this.filterGroup = parseInt(savedFilterGroup);
                }
                
                // Загружаем фильтр статуса
                const savedFilterCompleted = localStorage.getItem(this.storageKeys.filterCompleted);
                if (savedFilterCompleted) {
                    this.filterCompleted = savedFilterCompleted;
                }
                
                // Загружаем последние выбранные группы
                const savedLastGroups = localStorage.getItem(this.storageKeys.lastGroups);
                if (savedLastGroups && this.groups.length > 0) {
                    try {
                        const groupIds = JSON.parse(savedLastGroups);
                        this.editingForm.selectedGroups = this.groups.filter(group => 
                            groupIds.includes(group.id)
                        );
                    } catch (e) {
                        console.warn('Failed to parse last groups from storage:', e);
                    }
                }

                // Загружаем настройки формы
                const savedFormSettings = localStorage.getItem(this.storageKeys.formSettings);
                if (savedFormSettings) {
                    try {
                        const formSettings = JSON.parse(savedFormSettings);
                        // Обновляем только те поля, которые не являются уникальными для каждого напоминания
                        this.editingForm.days = formSettings.days || 0;
                        this.editingForm.hours = formSettings.hours || 0;
                        this.editingForm.minutes = formSettings.minutes || 5;
                        this.editingForm.timeMode = formSettings.timeMode || 'relative';
                        this.editingForm.repeatInterval = formSettings.repeatInterval || 0;
                        this.editingForm.maxRepeats = formSettings.maxRepeats || 1;
                    } catch (e) {
                        console.warn('Failed to parse form settings from storage:', e);
                    }
                }
            },

            saveToStorage() {
                // Сохраняем фильтр группы
                if (this.filterGroup) {
                    localStorage.setItem(this.storageKeys.filterGroup, this.filterGroup.toString());
                } else {
                    localStorage.removeItem(this.storageKeys.filterGroup);
                }
                
                // Сохраняем фильтр статуса
                if (this.filterCompleted) {
                    localStorage.setItem(this.storageKeys.filterCompleted, this.filterCompleted);
                } else {
                    localStorage.removeItem(this.storageKeys.filterCompleted);
                }
                
                // Сохраняем последние выбранные группы
                if (this.editingForm.selectedGroups.length > 0) {
                    const groupIds = this.editingForm.selectedGroups.map(group => group.id);
                    localStorage.setItem(this.storageKeys.lastGroups, JSON.stringify(groupIds));
                }

                // Сохраняем настройки формы (кроме текста и absoluteTime)
                const formSettings = {
                    days: this.editingForm.days,
                    hours: this.editingForm.hours,
                    minutes: this.editingForm.minutes,
                    timeMode: this.editingForm.timeMode,
                    repeatInterval: this.editingForm.repeatInterval,
                    maxRepeats: this.editingForm.maxRepeats
                };
                localStorage.setItem(this.storageKeys.formSettings, JSON.stringify(formSettings));
            },

            sortReminders(reminders) {
                const now = new Date();
                
                return [...reminders].sort((a, b) => {
                    const aCompleted = a.is_completed;
                    const bCompleted = b.is_completed;
                    
                    if (aCompleted !== bCompleted) {
                        return aCompleted ? 1 : -1;
                    }
                    
                    if (!aCompleted && !bCompleted) {
                        const aTime = new Date(a.due_time);
                        const bTime = new Date(b.due_time);
                        return aTime - bTime;
                    }
                    
                    if (aCompleted && bCompleted) {
                        const aSent = new Date(a.sent_at);
                        const bSent = new Date(b.sent_at);
                        return bSent - aSent;
                    }
                    
                    return 0;
                });
            },

            formatTextWithLinks(text) {
                if (!text) return '';
                const ticketRegex = /\b(\d{8,9})\b/g;
                return text.replace(ticketRegex, (match) => {
                    return `<a href="https://ttms/ttms/ticket?id=${match}" target="_blank" class="ticket-link">${match}</a>`;
                });
            },

            async loadReminders(page = 1, isRefresh = false) {
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
                        if (!reminder.is_completed) {
                            this.startReminderTimer(reminder);
                        }
                    });
            
                } catch (err) {
                    console.error('Error loading reminders:', err);
                    if (!isRefresh) {
                        this.error = 'Ошибка загрузки напоминаний';
                    }
                } finally {
                    if (!isRefresh) {
                        this.loading = false;
                    }
                    if (!this.initialLoadComplete) {
                        this.initialLoadComplete = true;
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

            formatRepeatInterval(minutes) {
                const intervals = {
                    1: '1 мин',
                    5: '5 мин',
                    10: '10 мин',
                    15: '15 мин',
                    30: '30 мин',
                    60: '1 час',
                    120: '2 часа',
                    1440: '1 день',
                    10080: '1 нед.'
                };
                
                if (intervals[minutes]) {
                    return intervals[minutes];
                }
            },

            startReminderTimer(reminder) {
                // Очищаем существующий таймер
                if (this.reminderTimers[reminder.id]) {
                    clearInterval(this.reminderTimers[reminder.id]);
                }
            
                const timerId = setInterval(() => {
                    const now = new Date();
                    const due = new Date(reminder.due_time);
                    const diffMs = due - now;
            
                    // Если время пришло и напоминание не в процессе отправки и не завершено
                    if (diffMs <= 0 && !this.remindersBeingSent.includes(reminder.id) && !reminder.is_completed) {
                        this.triggerReminderIfNeeded(reminder.id);
                    }
                    
                    // Если напоминание завершено, останавливаем таймер
                    if (reminder.is_completed) {
                        clearInterval(this.reminderTimers[reminder.id]);
                        delete this.reminderTimers[reminder.id];
                    }
                }, 1000);
            
                this.reminderTimers[reminder.id] = timerId;
            },

            async toggleCompleted(reminder) {
                const newStatus = !reminder.is_completed;
                reminder.is_completed = newStatus;

                try {
                    const response = await fetch(reminder.updateUrl, {
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
                } catch (err) {
                    console.error('Error updating reminder status:', err);
                    reminder.is_completed = !newStatus;
                    this.error = 'Ошибка обновления статуса';
                }
            },

            showCreateForm() {
                this.error = null;
                this.formSubmitted = false;
                this.isFormActive = true;
                this.editingForm = {
                    isActive: true,
                    mode: 'create',
                    id: null,
                    text: '', // Текст всегда очищаем
                    selectedGroups: [...this.editingForm.selectedGroups],
                    days: this.editingForm.days,
                    hours: this.editingForm.hours,
                    minutes: this.editingForm.minutes,
                    timeMode: this.editingForm.timeMode,
                    absoluteTime: this.getCurrentDateTime(),
                    repeatInterval: this.editingForm.repeatInterval,
                    maxRepeats: this.editingForm.maxRepeats
                };
            },

            startEditing(reminder) {
                const now = new Date();
                const due = new Date(reminder.due_time);
                const diffMs = due - now;
                
                let timeMode = 'absolute';
                let days = 0, hours = 0, minutes = 0;
                let absoluteTime = '';

                if (diffMs > 0 && diffMs <= 30 * 24 * 3600000) {
                    days = Math.floor(diffMs / 86400000);
                    hours = Math.floor((diffMs % 86400000) / 3600000);
                    minutes = Math.floor((diffMs % 3600000) / 60000);
                    timeMode = 'relative';
                } else {
                    absoluteTime = this.utcToLocal(reminder.due_time);
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
                    absoluteTime,
                    timeMode,
                    repeatInterval: reminder.repeat_interval_minutes || 0,
                    maxRepeats: reminder.max_repeats || 1
                };
            },

            async submitForm() {
                this.formSubmitted = true;
                
                if (!this.editingForm.text.trim()) {
                    this.error = 'Текст обязателен';
                    return;
                }
        
                if (this.editingForm.selectedGroups.length === 0) {
                    this.error = 'Выберите хотя бы одну группу';
                    return;
                }

                let dueTime;
                
                if (this.editingForm.timeMode === 'relative') {
                    const totalMs = (
                        this.editingForm.days * 86400000 +
                        this.editingForm.hours * 3600000 +
                        this.editingForm.minutes * 60000
                    );
        
                    if (totalMs <= 0) {
                        this.error = 'Укажите положительное время';
                        return;
                    }
        
                    dueTime = new Date(Date.now() + totalMs).toISOString();
                } else {
                    if (!this.editingForm.absoluteTime) {
                        this.error = 'Укажите дату и время';
                        return;
                    }
                    
                    // Преобразуем локальное время в UTC для отправки на сервер
                    const selectedTime = new Date(this.editingForm.absoluteTime + ':00');
                    // Учитываем смещение временной зоны
                    const timezoneOffset = selectedTime.getTimezoneOffset() * 60000;
                    const utcDate = new Date(selectedTime.getTime() + timezoneOffset);
                    dueTime = utcDate.toISOString();
                }
        
                const payload = {
                    text: this.editingForm.text,
                    groups: this.editingForm.selectedGroups.map(g => ({ id: g.id })),
                    due_time: dueTime,
                    is_completed: false,
                    sent_at: null,
                    repeat_interval_minutes: this.editingForm.repeatInterval,
                    max_repeats: this.editingForm.maxRepeats
                };
        
                try {
                    let url, method;
        
                    if (this.editingForm.mode === 'create') {
                        url = data.remindersApiEndpoint;
                        method = 'POST';
                    } else {
                        url = `${data.updateReminderBaseUrl}${this.editingForm.id}/`;
                        method = 'PUT';
                    }
        
                    const response = await fetch(url, {
                        method: method,
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    });
        
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(errorText);
                    }
        
                    const result = await response.json();
                    result.updateUrl = `${data.updateReminderBaseUrl}${result.id}/`;
                    result.deleteUrl = `${data.deleteReminderBaseUrl}${result.id}/`;

                    // Сохраняем настройки формы после успешной отправки
                    this.saveToStorage();
        
                    if (this.editingForm.mode === 'create') {
                        this.reminders.push(result);
                    } else {
                        const index = this.reminders.findIndex(r => r.id === result.id);
                        if (index !== -1) {
                            this.reminders.splice(index, 1, result);
                        }
                    }
        
                    this.cancelForm(); 
                    this.formSubmitted = false;
                } catch (err) {
                    console.error('Form submission error:', err);
                    this.error = this.editingForm.mode === 'create'
                        ? 'Ошибка создания напоминания: ' + err.message
                        : 'Ошибка обновления напоминания: ' + err.message;
                    this.isFormActive = true;
                }
            },

            formatTimeLeft(isoString, reminderId) {
                const now = this.currentTime;
                const due = new Date(isoString);
                const diffMs = due - now;
            
                const reminder = this.reminders.find(r => r.id === reminderId);
                
                if (reminder && reminder.is_completed) {
                    return `${this.formatDate(reminder.sent_at)}`;
                }
                
                if (diffMs <= 0) {
                    return 'Сейчас';
                }

                return this.formatTimeDiff(diffMs);
            },
            
            formatTimeDiff(diffMs) {
                if (diffMs <= 0) {
                    return '0с';
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
                            // Останавливаем таймер для завершенного напоминания
                            if (this.reminderTimers[reminderId]) {
                                clearInterval(this.reminderTimers[reminderId]);
                                delete this.reminderTimers[reminderId];
                            }
                        }
                    } else if (result.status === 'repeated' && result.reminder) {
                        // Обновляем данные напоминания для повторения
                        const reminder = this.reminders.find(r => r.id === reminderId);
                        if (reminder) {
                            Object.assign(reminder, result.reminder);
                            // Перезапускаем таймер для нового времени
                            this.startReminderTimer(reminder);
                        }
                    } else if (result.status === 'already_completed') {
                        // Напоминание уже завершено - обновляем локальное состояние
                        const reminder = this.reminders.find(r => r.id === reminderId);
                        if (reminder) {
                            reminder.is_completed = true;
                            if (this.reminderTimers[reminderId]) {
                                clearInterval(this.reminderTimers[reminderId]);
                                delete this.reminderTimers[reminderId];
                            }
                        }
                    } else if (result.status === 'already_sending') {
                        // Уже отправляется - ждем следующей попытки
                        console.log(`Reminder ${reminderId} is already being sent`);
                    } else if (result.status === 'not_due_yet') {
                        // Еще не время - перезапускаем таймер
                        const reminder = this.reminders.find(r => r.id === reminderId);
                        if (reminder) {
                            this.startReminderTimer(reminder);
                        }
                    } else {
                        console.log("[triggerReminderIfNeeded] Unknown status:", result);
                    }
                } catch (err) {
                    console.error('Error triggering reminder:', err);
                    // При ошибке сети тоже сбрасываем флаг, чтобы можно было повторить
                    const reminder = this.reminders.find(r => r.id === reminderId);
                    if (reminder) {
                        this.startReminderTimer(reminder);
                    }
                } finally {
                    const index = this.remindersBeingSent.indexOf(reminderId);
                    if (index !== -1) {
                        this.remindersBeingSent.splice(index, 1);
                    }
                }
            },

            cancelForm() {
                this.error = null; 
                this.formSubmitted = false;
                this.isFormActive = false;
                this.editingForm.isActive = false;
                
                // Сохраняем текущие настройки формы (кроме текста и ID)
                Object.assign(this.editingForm, {
                    mode: 'create',
                    id: null,
                    text: '', 
                    absoluteTime: this.getCurrentDateTime(), 
                });
                this.saveToStorage();
            },

            async deleteReminder(reminder) {
                if (!confirm('Вы уверены, что хотите удалить это напоминание?')) return;

                try {
                    const response = await fetch(reminder.deleteUrl, {
                        method: 'DELETE',
                        headers: {
                            'X-CSRFToken': data.csrfToken,
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    this.reminders = this.reminders.filter(r => r.id !== reminder.id);
                } catch (err) {
                    console.error('Error deleting reminder:', err);
                    this.error = 'Ошибка удаления напоминания';
                }
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
                const delta = 2;

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
            this.loadFromStorage();
            await this.loadReminders();

            this.timerInterval = setInterval(() => {
                this.currentTime = new Date();
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
            Object.values(this.reminderTimers).forEach(clearInterval);
        }
    }).mount('#reminders-app');
});