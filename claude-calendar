import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Clock, Calendar, Palette, Upload, Image } from 'lucide-react';

const CalendarApp = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month'); // 'month', 'week', 'day'
  const [events, setEvents] = useState([
    {
      id: 1,
      title: 'Team Meeting',
      start: new Date(2026, 0, 16, 10, 0),
      end: new Date(2026, 0, 16, 11, 0),
      color: 'bg-blue-500'
    },
    {
      id: 2,
      title: 'Project Deadline',
      start: new Date(2026, 0, 20, 9, 0),
      end: new Date(2026, 0, 20, 17, 0),
      color: 'bg-red-500'
    }
  ]);
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [newEvent, setNewEvent] = useState({
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    color: 'bg-blue-500',
    customColor: null
  });
  const [showBackgroundMenu, setShowBackgroundMenu] = useState(false);
  const [background, setBackground] = useState({ type: 'color', value: 'bg-white' });
  const [customColor, setCustomColor] = useState('#ffffff');
  const [pendingImage, setPendingImage] = useState(null);

  const colors = [
    { name: 'Blue', class: 'bg-blue-500' },
    { name: 'Red', class: 'bg-red-500' },
    { name: 'Green', class: 'bg-green-500' },
    { name: 'Purple', class: 'bg-purple-500' },
    { name: 'Orange', class: 'bg-orange-500' },
    { name: 'Pink', class: 'bg-pink-500' },
    { name: 'Indigo', class: 'bg-indigo-500' },
    { name: 'Teal', class: 'bg-teal-500' },
    { name: 'Cyan', class: 'bg-cyan-500' },
    { name: 'Amber', class: 'bg-amber-500' }
  ];

  const backgroundColors = [
    { name: 'White', class: 'bg-white' },
    { name: 'Light Gray', class: 'bg-gray-50' },
    { name: 'Slate', class: 'bg-slate-100' },
    { name: 'Blue', class: 'bg-blue-50' },
    { name: 'Indigo', class: 'bg-indigo-50' },
    { name: 'Purple', class: 'bg-purple-50' },
    { name: 'Pink', class: 'bg-pink-50' },
    { name: 'Rose', class: 'bg-rose-50' },
    { name: 'Orange', class: 'bg-orange-50' },
    { name: 'Amber', class: 'bg-amber-50' },
    { name: 'Yellow', class: 'bg-yellow-50' },
    { name: 'Lime', class: 'bg-lime-50' },
    { name: 'Green', class: 'bg-green-50' },
    { name: 'Emerald', class: 'bg-emerald-50' },
    { name: 'Teal', class: 'bg-teal-50' },
    { name: 'Cyan', class: 'bg-cyan-50' }
  ];

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(year, month, -startingDayOfWeek + i + 1);
      days.push({ date: prevMonthDay, isCurrentMonth: false });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  };

  const getWeekDays = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    const weekStart = new Date(d.setDate(diff));
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }
    return days;
  };

  const navigateDate = (direction) => {
    const newDate = new Date(currentDate);
    if (view === 'month') {
      newDate.setMonth(newDate.getMonth() + direction);
    } else if (view === 'week') {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
      newDate.setDate(newDate.getDate() + direction);
    }
    setCurrentDate(newDate);
  };

  const getEventsForDate = (date) => {
    return events.filter(e => {
      const eventDate = new Date(e.start);
      return eventDate.getDate() === date.getDate() &&
             eventDate.getMonth() === date.getMonth() &&
             eventDate.getFullYear() === date.getFullYear();
    });
  };

  const handleAddEvent = () => {
    if (!newEvent.title || !selectedDate) return;

    const [startHour, startMin] = newEvent.startTime.split(':');
    const [endHour, endMin] = newEvent.endTime.split(':');
    
    const start = new Date(selectedDate);
    start.setHours(parseInt(startHour), parseInt(startMin), 0);
    
    const end = new Date(selectedDate);
    end.setHours(parseInt(endHour), parseInt(endMin), 0);

    const eventColor = newEvent.customColor || newEvent.color;

    if (editingEvent) {
      // Update existing event
      setEvents(events.map(e => 
        e.id === editingEvent.id 
          ? { ...e, title: newEvent.title, start, end, color: eventColor }
          : e
      ));
    } else {
      // Create new event
      const event = {
        id: Date.now(),
        title: newEvent.title,
        start,
        end,
        color: eventColor
      };
      setEvents([...events, event]);
    }

    setShowEventModal(false);
    setEditingEvent(null);
    setNewEvent({ title: '', startTime: '09:00', endTime: '10:00', color: 'bg-blue-500', customColor: null });
  };

  const handleDeleteEvent = (id) => {
    setEvents(events.filter(e => e.id !== id));
  };

  const openEventModal = (date) => {
    setSelectedDate(date);
    setEditingEvent(null);
    setNewEvent({ title: '', startTime: '09:00', endTime: '10:00', color: 'bg-blue-500', customColor: null });
    setShowEventModal(true);
  };

  const openEditModal = (event, e) => {
    e.stopPropagation();
    setSelectedDate(event.start);
    setEditingEvent(event);
    
    const startTime = `${String(event.start.getHours()).padStart(2, '0')}:${String(event.start.getMinutes()).padStart(2, '0')}`;
    const endTime = `${String(event.end.getHours()).padStart(2, '0')}:${String(event.end.getMinutes()).padStart(2, '0')}`;
    
    // Check if color is a custom hex color or a class
    const isCustomColor = event.color.startsWith('#');
    
    setNewEvent({
      title: event.title,
      startTime: startTime,
      endTime: endTime,
      color: isCustomColor ? 'bg-blue-500' : event.color,
      customColor: isCustomColor ? event.color : null
    });
    setShowEventModal(true);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPendingImage(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const applyPendingImage = () => {
    if (pendingImage) {
      setBackground({ type: 'image', value: pendingImage });
      setPendingImage(null);
    }
  };

  const cancelPendingImage = () => {
    setPendingImage(null);
  };

  // Handle Escape key to close modals
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (showEventModal) {
          setShowEventModal(false);
          setEditingEvent(null);
        }
        if (showBackgroundMenu) {
          setShowBackgroundMenu(false);
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showEventModal, showBackgroundMenu]);

  const handleBackgroundColor = (colorClass) => {
    setBackground({ type: 'color', value: colorClass });
  };

  const handleCustomColor = (color) => {
    setCustomColor(color);
    setBackground({ type: 'custom', value: color });
  };

  const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const renderMonthView = () => {
    const days = getDaysInMonth(currentDate);
    
    return (
      <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200">
        {dayNames.map(day => (
          <div key={day} className="bg-gray-50 p-2 text-center font-semibold text-sm text-gray-700">
            {day}
          </div>
        ))}
        {days.map((day, idx) => {
          const dayEvents = getEventsForDate(day.date);
          return (
            <div
              key={idx}
              className={`bg-white min-h-24 p-2 ${!day.isCurrentMonth ? 'bg-gray-50' : ''} ${
                isToday(day.date) ? 'ring-2 ring-blue-500' : ''
              } hover:bg-gray-50 cursor-pointer`}
              onClick={() => openEventModal(day.date)}
            >
              <div className={`text-sm mb-1 ${!day.isCurrentMonth ? 'text-gray-400' : 'text-gray-700'} ${
                isToday(day.date) ? 'font-bold text-blue-600' : ''
              }`}>
                {day.date.getDate()}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map(event => (
                  <div
                    key={event.id}
                    className={`${event.color.startsWith('#') ? '' : event.color} text-white text-xs p-1 rounded truncate group relative cursor-pointer`}
                    style={event.color.startsWith('#') ? { backgroundColor: event.color } : {}}
                    onClick={(e) => openEditModal(event, e)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{event.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEvent(event.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 ml-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-gray-500">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDays = getWeekDays(currentDate);
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-8 border-b border-gray-200 bg-white">
          <div className="p-2"></div>
          {weekDays.map((day, idx) => (
            <div
              key={idx}
              className={`p-2 text-center ${isToday(day) ? 'bg-blue-50' : ''}`}
            >
              <div className="text-xs text-gray-500">{dayNames[day.getDay()]}</div>
              <div className={`text-lg ${isToday(day) ? 'font-bold text-blue-600' : ''}`}>
                {day.getDate()}
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-8 relative">
            <div className="border-r border-gray-200">
              {hours.map(hour => (
                <div key={hour} className="h-16 border-b border-gray-200 p-1 text-xs text-gray-500 text-right">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </div>
              ))}
            </div>
            {weekDays.map((day, dayIdx) => (
              <div key={dayIdx} className="border-r border-gray-200 relative">
                {hours.map(hour => (
                  <div
                    key={hour}
                    className="h-16 border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                    onClick={() => openEventModal(day)}
                  />
                ))}
                {getEventsForDate(day).map(event => {
                  const startHour = event.start.getHours();
                  const startMin = event.start.getMinutes();
                  const duration = (event.end - event.start) / (1000 * 60);
                  const top = (startHour * 64) + (startMin / 60 * 64);
                  const height = (duration / 60) * 64;

                  return (
                    <div
                      key={event.id}
                      className={`${event.color.startsWith('#') ? '' : event.color} text-white text-xs p-1 rounded absolute left-0 right-0 mx-1 group cursor-pointer`}
                      style={event.color.startsWith('#') ? { backgroundColor: event.color, top: `${top}px`, height: `${height}px`, minHeight: '24px' } : { top: `${top}px`, height: `${height}px`, minHeight: '24px' }}
                      onClick={(e) => openEditModal(event, e)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="truncate">
                          <div className="font-semibold">{event.title}</div>
                          <div>{formatTime(event.start)}</div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEvent(event.id);
                          }}
                          className="opacity-0 group-hover:opacity-100"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const dayEvents = getEventsForDate(currentDate);

    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-gray-200 bg-white p-4 text-center">
          <div className="text-sm text-gray-500">{dayNames[currentDate.getDay()]}</div>
          <div className={`text-2xl ${isToday(currentDate) ? 'font-bold text-blue-600' : ''}`}>
            {currentDate.getDate()}
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 relative">
            {hours.map(hour => (
              <div key={hour} className="h-16 border-b border-gray-200 flex">
                <div className="w-20 p-1 text-xs text-gray-500 text-right border-r border-gray-200">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </div>
                <div
                  className="flex-1 hover:bg-gray-50 cursor-pointer relative"
                  onClick={() => openEventModal(currentDate)}
                />
              </div>
            ))}
            <div className="absolute left-20 right-0 top-0">
              {dayEvents.map(event => {
                const startHour = event.start.getHours();
                const startMin = event.start.getMinutes();
                const duration = (event.end - event.start) / (1000 * 60);
                const top = (startHour * 64) + (startMin / 60 * 64);
                const height = (duration / 60) * 64;

                return (
                  <div
                    key={event.id}
                    className={`${event.color.startsWith('#') ? '' : event.color} text-white p-2 rounded absolute left-2 right-2 group cursor-pointer`}
                    style={event.color.startsWith('#') ? { backgroundColor: event.color, top: `${top}px`, height: `${height}px`, minHeight: '32px' } : { top: `${top}px`, height: `${height}px`, minHeight: '32px' }}
                    onClick={(e) => openEditModal(event, e)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold">{event.title}</div>
                        <div className="text-sm">{formatTime(event.start)} - {formatTime(event.end)}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEvent(event.id);
                        }}
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className={`border-b border-gray-200 p-4 ${background.type === 'color' ? background.value : background.type === 'custom' ? '' : 'bg-white'}`} style={background.type === 'custom' ? { backgroundColor: background.value } : {}}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="text-blue-600" size={32} />
              <h1 className="text-2xl font-semibold text-gray-800">Calendar</h1>
            </div>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Today
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigateDate(-1)}
                className="p-2 hover:bg-gray-100 rounded"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={() => navigateDate(1)}
                className="p-2 hover:bg-gray-100 rounded"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <h2 className="text-xl font-medium min-w-48">
              {view === 'month' && `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
              {view === 'week' && `Week of ${monthNames[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`}
              {view === 'day' && `${monthNames[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border border-gray-300 rounded overflow-hidden">
              <button
                onClick={() => setView('day')}
                className={`px-4 py-2 text-sm ${view === 'day' ? 'bg-blue-500 text-white' : 'hover:bg-gray-50'}`}
              >
                Day
              </button>
              <button
                onClick={() => setView('week')}
                className={`px-4 py-2 text-sm border-l border-r border-gray-300 ${view === 'week' ? 'bg-blue-500 text-white' : 'hover:bg-gray-50'}`}
              >
                Week
              </button>
              <button
                onClick={() => setView('month')}
                className={`px-4 py-2 text-sm ${view === 'month' ? 'bg-blue-500 text-white' : 'hover:bg-gray-50'}`}
              >
                Month
              </button>
            </div>
            <button
              onClick={() => setShowBackgroundMenu(!showBackgroundMenu)}
              className="p-2 border border-gray-300 rounded hover:bg-gray-50 relative"
              title="Change Background"
            >
              <Palette size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Background Menu */}
      {showBackgroundMenu && (
        <div className="absolute right-4 top-20 bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-80 z-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Background</h3>
            <button onClick={() => setShowBackgroundMenu(false)}>
              <X size={20} />
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Custom Color</h4>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => handleCustomColor(e.target.value)}
                  className="w-16 h-16 rounded border-2 border-gray-300 cursor-pointer"
                  title="Pick a custom color"
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={customColor}
                    onChange={(e) => handleCustomColor(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                    placeholder="#000000"
                  />
                  <p className="text-xs text-gray-500 mt-1">Enter hex color or use picker</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">Preset Colors</h4>
              <div className="grid grid-cols-4 gap-2">
                {backgroundColors.map(color => (
                  <button
                    key={color.class}
                    onClick={() => handleBackgroundColor(color.class)}
                    className={`h-12 rounded border-2 ${color.class} ${
                      background.type === 'color' && background.value === color.class
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="text-sm font-medium mb-2">Upload Image</h4>
              <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 hover:bg-gray-50">
                <div className="flex flex-col items-center">
                  <Upload size={24} className="text-gray-400 mb-1" />
                  <span className="text-sm text-gray-500">Click to upload</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
              
              {pendingImage && (
                <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                  <div className="relative h-32">
                    <img 
                      src={pendingImage} 
                      alt="Preview" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3 bg-gray-50 flex gap-2">
                    <button
                      onClick={applyPendingImage}
                      className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-medium"
                    >
                      Apply Image
                    </button>
                    <button
                      onClick={cancelPendingImage}
                      className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              
              {background.type === 'image' && !pendingImage && (
                <div className="mt-2 flex items-center justify-between p-2 bg-gray-50 rounded">
                  <div className="flex items-center gap-2">
                    <Image size={16} className="text-gray-500" />
                    <span className="text-sm text-gray-700">Active background</span>
                  </div>
                  <button
                    onClick={() => setBackground({ type: 'color', value: 'bg-white' })}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Calendar View */}
      <div className={`flex-1 overflow-hidden p-4 ${background.type === 'color' ? background.value : ''}`} style={background.type === 'custom' ? { backgroundColor: background.value } : {}}>
        {view === 'month' && renderMonthView()}
        {view === 'week' && renderWeekView()}
        {view === 'day' && renderDayView()}
      </div>

      {/* Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">
                {editingEvent ? 'Edit Event' : 'Add Event'}
              </h3>
              <button onClick={() => {
                setShowEventModal(false);
                setEditingEvent(null);
              }}>
                <X size={24} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Event Title</label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="Enter event title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Date</label>
                <div className="flex items-center gap-2 text-gray-700 bg-gray-50 px-3 py-2 rounded">
                  <Calendar size={16} />
                  {selectedDate?.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newEvent.startTime}
                    onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Time</label>
                  <input
                    type="time"
                    value={newEvent.endTime}
                    onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Color</label>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={newEvent.customColor || '#3b82f6'}
                      onChange={(e) => setNewEvent({ ...newEvent, customColor: e.target.value, color: 'bg-blue-500' })}
                      className="w-12 h-12 rounded border-2 border-gray-300 cursor-pointer"
                      title="Pick a custom color"
                    />
                    <div className="flex-1">
                      <input
                        type="text"
                        value={newEvent.customColor || ''}
                        onChange={(e) => setNewEvent({ ...newEvent, customColor: e.target.value, color: 'bg-blue-500' })}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                        placeholder="#3b82f6"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Or choose a preset:</p>
                    <div className="flex flex-wrap gap-2">
                      {colors.map(color => (
                        <button
                          key={color.class}
                          onClick={() => setNewEvent({ ...newEvent, color: color.class, customColor: null })}
                          className={`w-8 h-8 rounded ${color.class} ${
                            !newEvent.customColor && newEvent.color === color.class ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={handleAddEvent}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  {editingEvent ? 'Save Changes' : (
                    <>
                      <Plus size={16} />
                      Add Event
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowEventModal(false);
                    setEditingEvent(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarApp;
