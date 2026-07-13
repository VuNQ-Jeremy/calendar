/* @ds-bundle: {"format":3,"namespace":"MochiDesignSystem_472b36","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}]} */

import React from 'react';

const __ds_scope = {};

const __ds_errors = [];

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
})(); } catch (e) { __ds_errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

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
})(); } catch (e) { __ds_errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

export const Avatar = __ds_scope.Avatar;
export const Badge = __ds_scope.Badge;
export const Button = __ds_scope.Button;
export const Card = __ds_scope.Card;
export const IconButton = __ds_scope.IconButton;
export const Tag = __ds_scope.Tag;
export const ProgressBar = __ds_scope.ProgressBar;
export const Checkbox = __ds_scope.Checkbox;
export const Input = __ds_scope.Input;
export const Switch = __ds_scope.Switch;
export const Tabs = __ds_scope.Tabs;
