import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  isLoading?: boolean;
  prefixIcon?: ReactNode;
  suffixIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      isLoading = false,
      prefixIcon,
      suffixIcon,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      'font-semibold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';

    const sizeClasses = {
      sm: 'py-2 px-4 text-xs sm:text-sm',
      md: 'py-2.5 sm:py-3 px-4 sm:px-6 text-sm sm:text-base',
      lg: 'py-3 sm:py-4 px-6 sm:px-8 text-base sm:text-lg',
    };

    const iconSizes = {
      sm: 'w-3 h-3 sm:w-4 sm:h-4',
      md: 'w-4 h-4 sm:w-5 sm:h-5',
      lg: 'w-5 h-5 sm:w-6 sm:h-6',
    };

    const widthClass = fullWidth ? 'w-full' : '';

    const variantStyles = {
      primary: {
        backgroundColor: 'var(--primary-color)',
      },
      secondary: {
        backgroundColor: '#6b7280',
      },
      outline: {
        backgroundColor: 'transparent',
        border: '2px solid var(--primary-color)',
        color: 'var(--primary-color)',
      },
    };

    const hoverColors = {
      primary: 'var(--primary-hover)',
      secondary: '#4b5563',
      outline: 'var(--primary-color)',
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (variant === 'outline') {
        e.currentTarget.style.backgroundColor = hoverColors[variant];
        e.currentTarget.style.color = 'white';
      } else {
        e.currentTarget.style.backgroundColor = hoverColors[variant];
      }
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (variant === 'outline') {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.color = 'var(--primary-color)';
      } else {
        e.currentTarget.style.backgroundColor =
          variant === 'primary' ? 'var(--primary-color)' : (variantStyles[variant].backgroundColor as string);
      }
    };

    const textColor = variant === 'outline' ? '' : 'text-white';

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${sizeClasses[size]} ${widthClass} ${textColor} ${className}`}
        style={variantStyles[variant]}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <span>Loading...</span>
        ) : (
          <>
            {prefixIcon && <span className={iconSizes[size]}>{prefixIcon}</span>}
            <span>{children}</span>
            {suffixIcon && <span className={iconSizes[size]}>{suffixIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
