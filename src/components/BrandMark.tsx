import React from 'react';
import { ShieldCheck } from 'lucide-react';

export const BrandMark: React.FC<{ dark?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({
  dark = false,
  size = 'md',
}) => {
  const iconBox =
    size === 'lg'
      ? 'w-11 h-11 rounded-xl'
      : size === 'sm'
      ? 'w-7 h-7 rounded-lg'
      : 'w-8 h-8 rounded-lg';

  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 15 : 17;
  const textSize = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-base' : 'text-[17px]';

  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <div
        className={`${iconBox} bg-[#2563EB] flex items-center justify-center text-white shadow-sm`}
        aria-hidden="true"
      >
        <ShieldCheck size={iconSize} strokeWidth={2.2} />
      </div>
      <span
        className={`font-display font-bold tracking-tight ${textSize} ${
          dark ? 'text-white' : 'text-[#0F172A]'
        }`}
      >
        ComplianceOS
      </span>
    </div>
  );
};
