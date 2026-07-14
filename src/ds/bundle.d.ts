import type React from 'react';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';
type BtnSize = 'sm' | 'md' | 'lg';
type IcoVariant = 'ghost' | 'solid';
type BarColor = 'brand' | 'violet' | 'green' | 'blue';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  name?: string;
  color?: string | null;
  size?: AvatarSize;
  className?: string;
}
export declare function Avatar(props: AvatarProps): React.ReactElement;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string | null;
  className?: string;
  children?: React.ReactNode;
}
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  block?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  flat?: boolean;
  raised?: boolean;
  interactive?: boolean;
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
}
export declare function Card(props: CardProps): React.ReactElement;

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IcoVariant;
  size?: 'sm' | 'md';
  label: string;
  className?: string;
  children?: React.ReactNode;
}
export declare function IconButton(props: IconButtonProps): React.ReactElement;

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string | null;
  dot?: boolean;
  className?: string;
  children?: React.ReactNode;
}
export declare function Tag(props: TagProps): React.ReactElement;

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  color?: BarColor;
  className?: string;
}
export declare function ProgressBar(props: ProgressBarProps): React.ReactElement;

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  checked?: boolean;
  done?: boolean;
  className?: string;
}
export declare function Checkbox(props: CheckboxProps): React.ReactElement;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
  className?: string;
}
export declare function Input(props: InputProps): React.ReactElement;

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  label?: string;
  className?: string;
}
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface TabItem {
  id: string;
  label: string;
}
export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs?: TabItem[];
  value?: string;
  onChange?: (id: string) => void;
  className?: string;
}
export declare function Tabs(props: TabsProps): React.ReactElement;
