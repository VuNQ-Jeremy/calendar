/* @ds-bundle: {"format":3,"namespace":"MochiDesignSystem_472b36","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"aef7eb5dabe0","components/core/Badge.jsx":"0d188a706f15","components/core/Button.jsx":"f3c4e4c525f0","components/core/Card.jsx":"3ccd52e18233","components/core/IconButton.jsx":"ca040156342d","components/core/Tag.jsx":"261fc2e846dd","components/feedback/ProgressBar.jsx":"39180a00ae68","components/forms/Checkbox.jsx":"a79a7bcd1554","components/forms/Input.jsx":"b34f122ba1cf","components/forms/Switch.jsx":"a3e99fa36e2d","components/navigation/Tabs.jsx":"662560459455","ui_kits/app/App.jsx":"22bebc030d69","ui_kits/app/CalendarScreen.jsx":"3a28a1cb90f0","ui_kits/app/HomeworkScreen.jsx":"0fe699a80f9f","ui_kits/app/StudentsScreen.jsx":"4534ee1e9378","ui_kits/app/TodayScreen.jsx":"1ce85df53c04","ui_kits/app/data.jsx":"24f350afe0e2","ui_kits/app/icons.jsx":"cf670070e414"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.MochiDesignSystem_472b36 = window.MochiDesignSystem_472b36 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Avatar for students / family members. Shows an image, or initials fallback
 * tinted with a category color. Sizes: sm (32) | md (40) | lg (56) | xl (72).
 */
function Avatar({
  src = null,
  name = '',
  color = 'neutral',
  size = 'md',
  className = '',
  ...rest
}) {
  const px = {
    sm: 32,
    md: 40,
    lg: 56,
    xl: 72
  }[size] || 40;
  const map = {
    neutral: '',
    violet: 'is-violet',
    green: 'is-green',
    blue: 'is-blue',
    orange: 'is-orange'
  };
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const classes = ['mochi-avatar', map[color] || '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes,
    style: {
      width: px,
      height: px,
      fontSize: Math.round(px * 0.4)
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name
  }) : initials || '?');
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Small status / count badge. Color variants map to brand + category + status palette.
 */
function Badge({
  color = 'neutral',
  className = '',
  children,
  ...rest
}) {
  const map = {
    neutral: '',
    brand: 'is-brand',
    violet: 'is-violet',
    green: 'is-green',
    blue: 'is-blue',
    orange: 'is-orange',
    success: 'is-success',
    warning: 'is-warning',
    danger: 'is-danger'
  };
  const classes = ['mochi-badge', map[color] || '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mochi primary button. Pill-shaped, friendly, springy on press.
 * Variants: primary | secondary | ghost | soft | danger. Sizes: sm | md | lg.
 */
function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  iconLeft = null,
  iconRight = null,
  className = '',
  children,
  ...rest
}) {
  const classes = ['mochi-btn', `is-${variant}`, size !== 'md' ? `is-${size}` : '', block ? 'is-block' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes
  }, rest), iconLeft, children != null && /*#__PURE__*/React.createElement("span", null, children), iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mochi surface card. Soft rounded container with a warm shadow.
 * Variants via props: flat (no shadow), raised (bigger shadow), interactive (lifts on hover).
 */
function Card({
  flat = false,
  raised = false,
  interactive = false,
  as = 'div',
  className = '',
  children,
  ...rest
}) {
  const Tag = as;
  const classes = ['mochi-card', flat ? 'is-flat' : '', raised ? 'is-raised' : '', interactive ? 'is-interactive' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: classes
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Circular icon-only button. Pass a single icon element as children.
 * Variants: ghost (default) | solid. Sizes: sm | md.
 */
function IconButton({
  variant = 'ghost',
  size = 'md',
  label,
  className = '',
  children,
  ...rest
}) {
  const classes = ['mochi-icon-btn', variant === 'solid' ? 'is-solid' : '', size === 'sm' ? 'is-sm' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes,
    "aria-label": label,
    title: label
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Category / subject tag — pill with a leading color dot.
 * Use to label subjects (Math, Science…) and categories across calendar & homework.
 */
function Tag({
  color = 'neutral',
  dot = true,
  className = '',
  children,
  ...rest
}) {
  const map = {
    neutral: '',
    violet: 'is-violet',
    green: 'is-green',
    blue: 'is-blue',
    orange: 'is-orange'
  };
  const classes = ['mochi-tag', map[color] || '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    className: "mochi-tag__dot"
  }), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Slim progress bar. `value` is 0–100. Color variants match the category palette. */
function ProgressBar({
  value = 0,
  color = 'brand',
  className = '',
  ...rest
}) {
  const map = {
    brand: '',
    violet: 'is-violet',
    green: 'is-green',
    blue: 'is-blue'
  };
  const v = Math.max(0, Math.min(100, value));
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ['mochi-progress', className].filter(Boolean).join(' '),
    role: "progressbar",
    "aria-valuenow": v,
    "aria-valuemin": 0,
    "aria-valuemax": 100
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: ['mochi-progress__fill', map[color] || ''].filter(Boolean).join(' '),
    style: {
      width: `${v}%`
    }
  }));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Checkbox with a friendly rounded box and an animated check.
 * Set `done` to style the label as a completed task (struck through).
 */
function Checkbox({
  label,
  checked,
  done = false,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: ['mochi-check', done && checked ? 'is-done' : '', className].filter(Boolean).join(' ')
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "mochi-check__box",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 13l4 4L19 7",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text field with optional label, hint, and error. Wraps a styled <input>.
 */
function Input({
  label,
  hint,
  error,
  id,
  className = '',
  ...rest
}) {
  const fieldId = id || (label ? `f-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: "mochi-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "mochi-field__label",
    htmlFor: fieldId
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    className: ['mochi-input', error ? 'has-error' : '', className].filter(Boolean).join(' '),
    "aria-invalid": !!error
  }, rest)), error ? /*#__PURE__*/React.createElement("span", {
    className: "mochi-field__error"
  }, error) : hint && /*#__PURE__*/React.createElement("span", {
    className: "mochi-field__hint"
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Toggle switch. Controlled via `checked` + `onChange`. */
function Switch({
  checked,
  label,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: ['mochi-switch', className].filter(Boolean).join(' '),
    style: label ? {
      gap: 'var(--space-3)'
    } : undefined
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    checked: checked
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "mochi-switch__track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mochi-switch__thumb"
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-body)'
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill segmented tabs. `tabs` is an array of { id, label }. Controlled via `value` + `onChange(id)`.
 */
function Tabs({
  tabs = [],
  value,
  onChange,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ['mochi-tabs', className].filter(Boolean).join(' '),
    role: "tablist"
  }, rest), tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    role: "tab",
    "aria-selected": value === t.id,
    className: ['mochi-tabs__tab', value === t.id ? 'is-active' : ''].filter(Boolean).join(' '),
    onClick: () => onChange && onChange(t.id)
  }, t.label)));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/App.jsx
try { (() => {
// Mochi app shell — sidebar nav + topbar + screen routing
const {
  Avatar,
  Badge,
  IconButton
} = window.MochiDesignSystem_472b36;
const NAV = [{
  id: 'today',
  label: 'Today',
  icon: 'home'
}, {
  id: 'homework',
  label: 'Homework',
  icon: 'book'
}, {
  id: 'calendar',
  label: 'Calendar',
  icon: 'calendar'
}, {
  id: 'students',
  label: 'Students',
  icon: 'users'
}];
const HEADERS = {
  today: {
    title: 'Good morning, Sam',
    sub: 'Tuesday, April 15 · 5 things on today'
  },
  homework: {
    title: 'Homework',
    sub: 'Tap a box when it’s done — Mochi keeps score'
  },
  calendar: {
    title: 'Calendar',
    sub: 'The whole family’s week, color-coded by subject'
  },
  students: {
    title: 'Students',
    sub: 'Your little learners and their subjects'
  }
};
function Sidebar({
  active,
  onNav
}) {
  const D = window.MOCHI_DATA;
  const dueCount = D.homework.filter(h => !h.done && (h.due === 'Today' || h.status === 'late')).length;
  return /*#__PURE__*/React.createElement("aside", {
    className: "sb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb__brand"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mochi-logo.svg",
    alt: "Mochi"
  })), /*#__PURE__*/React.createElement("nav", {
    className: "sb__nav"
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: `sb__item ${active === n.id ? 'is-active' : ''}`,
    onClick: () => onNav(n.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 20
  }), n.label, n.id === 'homework' && dueCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, /*#__PURE__*/React.createElement(Badge, {
    color: "brand"
  }, dueCount))))), /*#__PURE__*/React.createElement("div", {
    className: "sb__foot"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Sam Kim",
    color: "orange",
    size: "md"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "nm"
  }, "Sam Kim"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, D.family)), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "Settings",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 18
  })))));
}
function App() {
  const [active, setActive] = React.useState('today');
  const h = HEADERS[active];
  const Screen = {
    today: window.TodayScreen,
    homework: window.HomeworkScreen,
    calendar: window.CalendarScreen,
    students: window.StudentsScreen
  }[active];
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: active,
    onNav: setActive
  }), /*#__PURE__*/React.createElement("div", {
    className: "main"
  }, /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, h.title), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, h.sub)), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement("label", {
    className: "search"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search homework, events\u2026"
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Notifications"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 20
  }))), /*#__PURE__*/React.createElement(Screen, null)));
}
window.MochiApp = App;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/CalendarScreen.jsx
try { (() => {
// Calendar screen — color-coded week view
const {
  Card,
  Badge,
  Tag,
  Button,
  Tabs,
  IconButton
} = window.MochiDesignSystem_472b36;
function CalendarScreen() {
  const D = window.MOCHI_DATA;
  const [view, setView] = React.useState('week');
  const todayIdx = 1; // Tue

  const evAt = (day, row) => D.calendar.filter(e => e.day === day && e.row === row);
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead"
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "Previous week"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevronLeft",
    size: 20
  })), /*#__PURE__*/React.createElement("h2", {
    style: {
      minWidth: 170,
      textAlign: 'center'
    }
  }, "April 14\u201318"), /*#__PURE__*/React.createElement(IconButton, {
    label: "Next week"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevronRight",
    size: 20
  })), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement(Tabs, {
    value: view,
    onChange: setView,
    tabs: [{
      id: 'day',
      label: 'Day'
    }, {
      id: 'week',
      label: 'Week'
    }, {
      id: 'month',
      label: 'Month'
    }]
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 18
    })
  }, "New event")), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "cal"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cal__hcell"
  }), D.week.map((d, i) => {
    const [w, n] = d.split(' ');
    return /*#__PURE__*/React.createElement("div", {
      className: `cal__hcell ${i === todayIdx ? 'is-today' : ''}`,
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      className: "w"
    }, w), /*#__PURE__*/React.createElement("div", {
      className: "d"
    }, n));
  }), D.calTimes.map((t, row) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: row
  }, /*#__PURE__*/React.createElement("div", {
    className: "cal__time"
  }, t), D.week.map((_, day) => /*#__PURE__*/React.createElement("div", {
    className: "cal__cell",
    key: day,
    style: day === 0 ? {
      borderLeft: 'none'
    } : undefined
  }, evAt(day, row).map((e, k) => /*#__PURE__*/React.createElement("div", {
    className: "cal__ev",
    key: k,
    style: {
      background: `var(--cat-${e.color}-soft)`,
      color: `var(--cat-${e.color}-ink)`
    }
  }, e.label)))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-4)',
      flexWrap: 'wrap',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      color: 'var(--text-muted)'
    }
  }, "Subjects"), /*#__PURE__*/React.createElement(Tag, {
    color: "blue"
  }, "Math"), /*#__PURE__*/React.createElement(Tag, {
    color: "green"
  }, "Reading"), /*#__PURE__*/React.createElement(Tag, {
    color: "violet"
  }, "Science \xB7 Music"), /*#__PURE__*/React.createElement(Tag, {
    color: "orange"
  }, "Art \xB7 Sports")));
}
window.CalendarScreen = CalendarScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/CalendarScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/HomeworkScreen.jsx
try { (() => {
// Homework screen — filterable, checkable task list
const {
  Card,
  Badge,
  Tag,
  Avatar,
  Button,
  Tabs,
  Checkbox
} = window.MochiDesignSystem_472b36;
function HomeworkScreen() {
  const D = window.MOCHI_DATA;
  const [who, setWho] = React.useState('all');
  const [items, setItems] = React.useState(D.homework);
  const studentById = Object.fromEntries(D.students.map(s => [s.id, s]));
  const toggle = id => setItems(items.map(it => it.id === id ? {
    ...it,
    done: !it.done
  } : it));
  const tabs = [{
    id: 'all',
    label: 'Everyone'
  }, ...D.students.map(s => ({
    id: s.id,
    label: s.name.split(' ')[0]
  }))];
  const visible = items.filter(it => who === 'all' || it.student === who);
  const open = visible.filter(it => !it.done);
  const done = visible.filter(it => it.done);
  const dueBadge = it => {
    if (it.done) return /*#__PURE__*/React.createElement(Badge, {
      color: "success"
    }, "Done");
    if (it.status === 'late') return /*#__PURE__*/React.createElement(Badge, {
      color: "danger"
    }, it.due);
    if (it.status === 'soon') return /*#__PURE__*/React.createElement(Badge, {
      color: "warning"
    }, it.due);
    return /*#__PURE__*/React.createElement(Badge, {
      color: "brand"
    }, it.due);
  };
  const Row = it => /*#__PURE__*/React.createElement("div", {
    className: `hw__row ${it.done ? 'is-done' : ''}`,
    key: it.id
  }, /*#__PURE__*/React.createElement(Checkbox, {
    checked: it.done,
    done: true,
    onChange: () => toggle(it.id)
  }), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, it.title), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement(Tag, {
    color: it.subjectColor
  }, it.subject), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement(Avatar, {
    name: studentById[it.student].name,
    color: studentById[it.student].color,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", null, studentById[it.student].name.split(' ')[0]))), dueBadge(it));
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead"
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: who,
    onChange: setWho,
    tabs: tabs
  }), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 18
    })
  }, "Add homework")), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("h2", null, "To do"), /*#__PURE__*/React.createElement(Badge, {
    color: "brand",
    style: {
      marginLeft: 8
    }
  }, open.length)), /*#__PURE__*/React.createElement("div", {
    className: "hw"
  }, open.length ? open.map(Row) : /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "All caught up here \u2014 nice work! \uD83C\uDF89"))), done.length > 0 && /*#__PURE__*/React.createElement(Card, {
    flat: true,
    style: {
      background: 'var(--cream-100)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "Done"), /*#__PURE__*/React.createElement(Badge, {
    color: "success",
    style: {
      marginLeft: 8
    }
  }, done.length)), /*#__PURE__*/React.createElement("div", {
    className: "hw"
  }, done.map(Row))));
}
window.HomeworkScreen = HomeworkScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/HomeworkScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/StudentsScreen.jsx
try { (() => {
// Students screen — manage family members & subjects
const {
  Card,
  Badge,
  Tag,
  Avatar,
  Button,
  ProgressBar,
  IconButton
} = window.MochiDesignSystem_472b36;
function StudentsScreen() {
  const D = window.MOCHI_DATA;
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead"
  }, /*#__PURE__*/React.createElement("h2", null, "Students"), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 18
    })
  }, "Add student")), /*#__PURE__*/React.createElement("div", {
    className: "students"
  }, D.students.map(s => {
    const openCount = D.homework.filter(h => h.student === s.id && !h.done).length;
    return /*#__PURE__*/React.createElement(Card, {
      key: s.id,
      interactive: true
    }, /*#__PURE__*/React.createElement("div", {
      className: "student"
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: s.name,
      color: s.color,
      size: "xl"
    }), /*#__PURE__*/React.createElement("div", {
      className: "info"
    }, /*#__PURE__*/React.createElement("div", {
      className: "nm"
    }, s.name), /*#__PURE__*/React.createElement("div", {
      className: "grade"
    }, s.grade), /*#__PURE__*/React.createElement("div", {
      className: "subjects"
    }, s.subjects.map((sub, i) => /*#__PURE__*/React.createElement(Tag, {
      key: i,
      color: sub.color
    }, sub.label))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 16,
        display: 'flex',
        gap: 'var(--space-5)',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 24,
        color: 'var(--text-strong)',
        lineHeight: 1
      }
    }, openCount), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)'
      }
    }, "open tasks")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("span", null, "This week"), /*#__PURE__*/React.createElement("span", {
      className: "mochi-numeric"
    }, s.progress, "%")), /*#__PURE__*/React.createElement(ProgressBar, {
      value: s.progress,
      color: s.color
    })))), /*#__PURE__*/React.createElement(IconButton, {
      label: "More"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "more",
      size: 20
    }))));
  }), /*#__PURE__*/React.createElement(Card, {
    flat: true,
    style: {
      background: 'var(--cream-100)',
      border: '1.5px dashed var(--border-strong)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 180
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 18
    })
  }, "Add another student"))));
}
window.StudentsScreen = StudentsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/StudentsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/TodayScreen.jsx
try { (() => {
// Today / dashboard screen
const {
  Card,
  Badge,
  Tag,
  Avatar,
  Button,
  ProgressBar,
  IconButton
} = window.MochiDesignSystem_472b36;
function StatCard({
  icon,
  tint,
  k,
  label
}) {
  return /*#__PURE__*/React.createElement(Card, {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ico",
    style: {
      background: `var(--cat-${tint}-soft)`,
      color: `var(--cat-${tint}-ink)`
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 22
  })), /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, k), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, label));
}
function TodayScreen() {
  const D = window.MOCHI_DATA;
  const dueToday = D.homework.filter(h => h.due === 'Today' && !h.done).length;
  const studentById = Object.fromEntries(D.students.map(s => [s.id, s]));
  const evColor = c => c === 'cream' ? {
    background: 'var(--cream-200)',
    color: 'var(--text-body)'
  } : {
    background: `var(--cat-${c}-soft)`,
    color: `var(--cat-${c}-ink)`
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid-stats"
  }, /*#__PURE__*/React.createElement(StatCard, {
    icon: "flag",
    tint: "orange",
    k: dueToday,
    label: "Due today"
  }), /*#__PURE__*/React.createElement(StatCard, {
    icon: "check",
    tint: "green",
    k: "2",
    label: "Done this morning"
  }), /*#__PURE__*/React.createElement(StatCard, {
    icon: "calendar",
    tint: "blue",
    k: "5",
    label: "Events today"
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid-2"
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead"
  }, /*#__PURE__*/React.createElement("h2", null, "Today's schedule"), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement(Badge, {
    color: "neutral"
  }, "Tue \xB7 Apr 15")), /*#__PURE__*/React.createElement("div", {
    className: "tl"
  }, D.schedule.map((e, i) => /*#__PURE__*/React.createElement("div", {
    className: "tl__row",
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl__time"
  }, e.time), /*#__PURE__*/React.createElement("div", {
    className: "tl__card",
    style: evColor(e.color)
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, e.title), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, e.meta)), /*#__PURE__*/React.createElement("span", {
    className: "who"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: studentById[e.who]?.name || '',
    color: studentById[e.who]?.color,
    size: "sm"
  }))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "sectionhead"
  }, /*#__PURE__*/React.createElement("h2", null, "The kids")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)'
    }
  }, D.students.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: s.name,
    color: s.color,
    size: "lg"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      color: 'var(--text-strong)'
    }
  }, s.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)',
      marginBottom: 6
    }
  }, s.progress, "% of this week done"), /*#__PURE__*/React.createElement(ProgressBar, {
    value: s.progress,
    color: s.color
  })))))), /*#__PURE__*/React.createElement(Card, {
    raised: true,
    style: {
      background: 'var(--brand-soft)',
      border: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "paw",
    size: 26,
    style: {
      color: 'var(--brand-soft-ink)',
      flex: 'none',
      marginTop: 2
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
      fontSize: 'var(--text-lg)',
      color: 'var(--brand-soft-ink)'
    }
  }, "Mochi's tip"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 12px',
      color: 'var(--brand-soft-ink)',
      fontSize: 'var(--text-sm)'
    }
  }, "Mia has piano overdue from yesterday \u2014 a quick 15 minutes after snack will clear it."), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary"
  }, "Mark as done")))))));
}
window.TodayScreen = TodayScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/TodayScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/data.jsx
try { (() => {
// Shared mock data for the Mochi UI kit.
const MOCHI_DATA = {
  family: 'The Kim Family',
  students: [{
    id: 'leo',
    name: 'Leo Kim',
    grade: 'Grade 4 · Maple Elementary',
    color: 'green',
    subjects: [{
      label: 'Math',
      color: 'blue'
    }, {
      label: 'Reading',
      color: 'green'
    }, {
      label: 'Science',
      color: 'violet'
    }, {
      label: 'Art',
      color: 'orange'
    }],
    progress: 70
  }, {
    id: 'mia',
    name: 'Mia Kim',
    grade: 'Grade 1 · Maple Elementary',
    color: 'violet',
    subjects: [{
      label: 'Reading',
      color: 'green'
    }, {
      label: 'Math',
      color: 'blue'
    }, {
      label: 'Music',
      color: 'violet'
    }],
    progress: 45
  }],
  schedule: [{
    time: '8:30',
    title: 'Drop-off — Maple Elementary',
    who: 'leo',
    color: 'cream',
    meta: 'Both kids'
  }, {
    time: '9:00',
    title: 'Math — Fractions quiz',
    who: 'leo',
    color: 'blue',
    meta: 'Leo · Room 12'
  }, {
    time: '10:30',
    title: 'Reading circle',
    who: 'mia',
    color: 'green',
    meta: 'Mia · Library'
  }, {
    time: '15:15',
    title: 'Pickup + snack',
    who: 'leo',
    color: 'cream',
    meta: 'Both kids'
  }, {
    time: '16:30',
    title: 'Soccer practice',
    who: 'leo',
    color: 'orange',
    meta: 'Leo · Field 3'
  }],
  homework: [{
    id: 1,
    title: 'Fractions worksheet, p.42–43',
    student: 'leo',
    subject: 'Math',
    subjectColor: 'blue',
    due: 'Today',
    status: 'due',
    done: false
  }, {
    id: 2,
    title: 'Read “Charlotte’s Web” ch. 4',
    student: 'leo',
    subject: 'Reading',
    subjectColor: 'green',
    due: 'Today',
    status: 'due',
    done: false
  }, {
    id: 3,
    title: 'Spelling words ×3 each',
    student: 'mia',
    subject: 'Reading',
    subjectColor: 'green',
    due: 'Tomorrow',
    status: 'soon',
    done: false
  }, {
    id: 4,
    title: 'Leaf collection for science',
    student: 'leo',
    subject: 'Science',
    subjectColor: 'violet',
    due: 'Fri',
    status: 'soon',
    done: false
  }, {
    id: 5,
    title: 'Practice piano — 15 min',
    student: 'mia',
    subject: 'Music',
    subjectColor: 'violet',
    due: 'Yesterday',
    status: 'late',
    done: false
  }, {
    id: 6,
    title: 'Draw your family portrait',
    student: 'leo',
    subject: 'Art',
    subjectColor: 'orange',
    due: 'Mon',
    status: 'done',
    done: true
  }, {
    id: 7,
    title: 'Count to 100 practice',
    student: 'mia',
    subject: 'Math',
    subjectColor: 'blue',
    due: 'Mon',
    status: 'done',
    done: true
  }],
  week: ['Mon 14', 'Tue 15', 'Wed 16', 'Thu 17', 'Fri 18'],
  calendar: [
  // {day:0-4, start: rowIndex, label, color}
  {
    day: 0,
    row: 1,
    label: 'Math quiz',
    color: 'blue'
  }, {
    day: 0,
    row: 4,
    label: 'Soccer',
    color: 'orange'
  }, {
    day: 1,
    row: 0,
    label: 'Reading circle',
    color: 'green'
  }, {
    day: 1,
    row: 3,
    label: 'Piano',
    color: 'violet'
  }, {
    day: 2,
    row: 1,
    label: 'Science fair',
    color: 'violet'
  }, {
    day: 2,
    row: 2,
    label: 'Library',
    color: 'green'
  }, {
    day: 3,
    row: 0,
    label: 'Art class',
    color: 'orange'
  }, {
    day: 3,
    row: 4,
    label: 'Swim',
    color: 'blue'
  }, {
    day: 4,
    row: 2,
    label: 'Field trip 🍂',
    color: 'green'
  }],
  calTimes: ['9:00', '10:00', '11:00', '13:00', '15:00']
};
window.MOCHI_DATA = MOCHI_DATA;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/data.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/icons.jsx
try { (() => {
// Mochi icon set — Lucide-style (24x24, 2px round stroke). Matches the soft brand.
// Lucide is the recommended icon system for Mochi; these are the glyphs used in the kit.
const ICON_PATHS = {
  home: '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.39 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.153 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10z"/>'
};
function Icon({
  name,
  size = 22,
  className = '',
  style = {}
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className,
    style: style,
    "aria-hidden": "true",
    dangerouslySetInnerHTML: {
      __html: ICON_PATHS[name] || ''
    }
  });
}
window.Icon = Icon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
