import React from 'react';
import styles from './Tooltip.module.css';

export interface TooltipStats {
  label: string;
  value: string | number;
  color?: string; // Optional color for specific stats
}
export interface TooltipContent {
  name: string;
  description?: string;
  stats?: TooltipStats[];
  category?: string;
  rarity?: string; // Example: Common, Uncommon, Rare, Epic
}

interface TooltipProps {
  content: TooltipContent | null;
  visible: boolean;
  position: { x: number; y: number };
}

const Tooltip: React.FC<TooltipProps> = ({ content, visible, position }) => {
  if (!visible || !content) {
    return null;
  }

  // Check if this is a simple tooltip (only name, no other content)
  const isSimple = (!content.category || content.category.trim() === '') && 
                   (!content.description || content.description.trim() === '') && 
                   (!content.stats || content.stats.length === 0);

  // Offset the tooltip slightly from the cursor
  const tooltipStyle = {
    left: `${position.x + 5}px`,
    top: `${position.y + 5}px`,
    ...(isSimple && { width: 'auto', minWidth: 'auto' }), // Use auto width for simple tooltips
  };

  return (
    <div className={styles.tooltipContainer} style={tooltipStyle}>
      <div className={`${styles.tooltipName} ${content.rarity ? styles[content.rarity.toLowerCase()] : ''} ${isSimple ? styles.simple : ''}`}>
        {content.name}
      </div>
      {content.category && <div className={styles.tooltipCategory}>{content.category}</div>}
      {content.description && <div className={styles.tooltipDescription}>{content.description}</div>}
      {content.stats && content.stats.length > 0 && (
        <div className={styles.tooltipStatsSection}>
          {content.stats.map((stat, index) => (
            <div key={index} className={styles.tooltipStat}>
              <span className={styles.statLabel}>{stat.label}:</span>
              <span className={styles.statValue} style={{ color: stat.color }}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Tooltip; 