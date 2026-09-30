import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        // Semantic actions: validate, caution, destroy, inform
        success:
          'bg-success text-success-foreground shadow-xs hover:bg-success/90 focus-visible:ring-success/30',
        warning:
          'bg-warning text-warning-foreground shadow-xs hover:bg-warning/90 focus-visible:ring-warning/30',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        info:
          'bg-info text-info-foreground shadow-xs hover:bg-info/90 focus-visible:ring-info/30',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        // Outlined, tinted: a secondary action with a meaning (approve, delete…)
        'success-outline':
          'border border-success/40 bg-success/8 text-success hover:bg-success/15',
        'danger-outline':
          'border border-destructive/40 bg-destructive/8 text-destructive hover:bg-destructive/15',
        'warning-outline':
          'border border-warning/40 bg-warning/8 text-warning hover:bg-warning/15',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        'danger-ghost':
          'text-destructive hover:bg-destructive/10 hover:text-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

// `loading`: spinner in place of the icon, button disabled while the action runs
function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  if (asChild) {
    return <Comp data-slot='button' className={cn(buttonVariants({ variant, size, className }))} {...props}>{children}</Comp>
  }
  return (
    <Comp
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }), loading && '[&>svg:not(.animate-spin)]:hidden')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className='animate-spin' aria-hidden />}
      {children}
    </Comp>
  )
}

export { Button, buttonVariants }
