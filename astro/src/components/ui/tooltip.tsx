import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  position?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
  className?: string;
}

export function Tooltip({
  children,
  content,
  position = 'top',
  delay = 300,
  className = '',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  // Position mapping
  const positionStyles = {
    top: 'translate(-50%, -100%) translateY(-8px)',
    right: 'translate(8px, -50%)',
    bottom: 'translate(-50%, 8px)',
    left: 'translate(-100%, -50%) translateX(-8px)',
  };

  // Arrow position classes
  const arrowClasses = {
    top: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45',
    right: 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 rotate-45',
    bottom: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45',
    left: 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rotate-45',
  };

  // Handle showing tooltip
  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    timerRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        let x = 0;
        let y = 0;
        
        switch (position) {
          case 'top':
            x = rect.left + rect.width / 2;
            y = rect.top;
            break;
          case 'right':
            x = rect.right;
            y = rect.top + rect.height / 2;
            break;
          case 'bottom':
            x = rect.left + rect.width / 2;
            y = rect.bottom;
            break;
          case 'left':
            x = rect.left;
            y = rect.top + rect.height / 2;
            break;
        }
        
        setCoords({ x, y });
        setIsVisible(true);
      }
    }, delay);
  };

  // Handle hiding tooltip
  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    
    setIsVisible(false);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="relative inline-block">
      {/* Tooltip trigger */}
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>
      
      {/* Tooltip content */}
      {isVisible && (
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: `${coords.y}px`,
            left: `${coords.x}px`,
            transform: positionStyles[position],
            zIndex: 50,
          }}
          className={`px-3 py-2 text-sm bg-gray-900 dark:bg-gray-800 text-white rounded shadow-md max-w-xs ${className}`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Tooltip content */}
          {content}
          
          {/* Tooltip arrow */}
          <div 
            className={`absolute w-2 h-2 bg-gray-900 dark:bg-gray-800 ${arrowClasses[position]}`}
          />
        </div>
      )}
    </div>
  );
}