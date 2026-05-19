import { useState, useRef, useEffect, useId } from 'react';
import type { ReactNode } from 'react';

interface TooltipProps {
	children: ReactNode;
	content: ReactNode;
	position?: 'top' | 'right' | 'bottom' | 'left';
	delay?: number;
	className?: string;
}

export function Tooltip({ children, content, position = 'top', delay = 200, className = '' }: TooltipProps) {
	const [isVisible, setIsVisible] = useState(false);
	const [coords, setCoords] = useState({ x: 0, y: 0 });
	const tooltipRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLDivElement>(null);
	const timerRef = useRef<number | null>(null);
	const tooltipId = useId();

	// Position mapping
	const positionStyles = {
		top: 'translate(-50%, -100%) translateY(-6px)',
		right: 'translate(6px, -50%)',
		bottom: 'translate(-50%, 6px)',
		left: 'translate(-100%, -50%) translateX(-6px)',
	};

	const handleShow = () => {
		if (timerRef.current) clearTimeout(timerRef.current);
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

	const handleHide = () => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setIsVisible(false);
	};

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	return (
		<div className="relative inline-block">
			<div
				ref={triggerRef}
				onMouseEnter={handleShow}
				onMouseLeave={handleHide}
				onFocus={handleShow}
				onBlur={handleHide}
				aria-describedby={isVisible ? tooltipId : undefined}
				className="inline-block"
			>
				{children}
			</div>

			{isVisible && (
				<div
					id={tooltipId}
					ref={tooltipRef}
					role="tooltip"
					style={{
						position: 'fixed',
						top: `${coords.y}px`,
						left: `${coords.x}px`,
						transform: positionStyles[position],
						zIndex: 50,
					}}
					className={`px-2 py-1 text-xs bg-foreground text-background border border-foreground max-w-xs ${className}`}
					onMouseEnter={handleShow}
					onMouseLeave={handleHide}
				>
					{content}
				</div>
			)}
		</div>
	);
}
