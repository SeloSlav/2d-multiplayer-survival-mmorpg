/**
 * formatUtils.ts
 * 
 * Utility functions for formatting data for display in the UI.
 */

/**
 * Formats a numerical stat for display, with options for percentage and sign.
 * @param value The numerical value of the stat.
 * @param isPercentage Whether to display the value as a percentage (appends '%'). Defaults to false.
 * @param signed Whether to prepend a '+' sign for positive values. Defaults to true.
 * @returns A string representation of the formatted stat.
 */
export const formatStatDisplay = (value: number, isPercentage: boolean = false, signed: boolean = true): string => {
    const roundedValue = Math.round(value * 10) / 10; // Rounds to one decimal place
    const sign = signed && roundedValue > 0 ? '+' : '';
    const percentage = isPercentage ? '%' : '';
    return `${sign}${roundedValue}${percentage}`;
}; 