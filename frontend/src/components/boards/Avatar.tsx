import React, { useState } from 'react';
import type { User } from '../../types';

const AVATAR_BG = ['bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-green-500', 'bg-blue-500', 'bg-amber-500', 'bg-rose-500'];

export const avatarColor = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return AVATAR_BG[Math.abs(h) % AVATAR_BG.length];
};

export const Avatar: React.FC<{ user: User; size?: string; textSize?: string }> = ({
  user,
  size = 'h-9 w-9',
  textSize = 'text-sm',
}) => {
  const [imgError, setImgError] = useState(false);
  if (user.profileImageUrl && !imgError) {
    return (
      <img
        className={`${size} rounded-full object-cover border-2 border-gray-300 flex-shrink-0`}
        src={user.profileImageUrl}
        alt={user.name}
        title={user.name}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center ${textSize} text-white font-medium border-2 border-gray-300 flex-shrink-0 ${avatarColor(user.id)}`}
      title={user.name}
      aria-label={user.name}
    >
      {user.name?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
};
