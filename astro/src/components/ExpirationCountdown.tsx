import { useState, useEffect } from 'react';

interface ExpirationCountdownProps {
  expiresAt: string;
  className?: string;
}

export function ExpirationCountdown({ expiresAt, className = '' }: ExpirationCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    expired: boolean;
  }>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    expired: false,
  });
  
  const [isNearExpiry, setIsNearExpiry] = useState(false);
  
  // Calculate time left
  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const expiration = new Date(expiresAt);
      const diff = expiration.getTime() - now.getTime();
      
      if (diff <= 0) {
        // Already expired
        return {
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          expired: true
        };
      }
      
      // Check if near expiry (less than 1 hour)
      setIsNearExpiry(diff < 60 * 60 * 1000);
      
      // Calculate time units
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      return {
        days,
        hours,
        minutes,
        seconds,
        expired: false
      };
    };
    
    // Initialize
    setTimeLeft(calculateTimeLeft());
    
    // Update every second
    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft();
      setTimeLeft(newTimeLeft);
      
      // Clear interval if expired
      if (newTimeLeft.expired) {
        clearInterval(timer);
      }
    }, 1000);
    
    // Clear on unmount
    return () => clearInterval(timer);
  }, [expiresAt]);
  
  // Format as readable text
  const formatTimeLeft = () => {
    if (timeLeft.expired) {
      return 'Expired';
    }
    
    if (timeLeft.days > 0) {
      return `Expires in ${timeLeft.days}d ${timeLeft.hours}h`;
    }
    
    if (timeLeft.hours > 0) {
      return `Expires in ${timeLeft.hours}h ${timeLeft.minutes}m`;
    }
    
    if (timeLeft.minutes > 0) {
      return `Expires in ${timeLeft.minutes}m ${timeLeft.seconds}s`;
    }
    
    return `Expires in ${timeLeft.seconds}s`;
  };
  
  // If more than a day left, don't show the countdown
  if (timeLeft.days > 1 && !isNearExpiry) {
    return null;
  }
  
  return (
    <div className={`${className} 
      ${isNearExpiry 
        ? 'text-red-600 dark:text-red-400 font-medium' 
        : 'text-amber-600 dark:text-amber-400'
      }`}
    >
      <div className="flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {formatTimeLeft()}
      </div>
    </div>
  );
}