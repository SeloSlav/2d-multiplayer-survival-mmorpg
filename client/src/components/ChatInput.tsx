import React, { useEffect, forwardRef } from 'react';
import styles from './Chat.module.css';

interface ChatInputProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onCloseChat: () => void; // Callback to close the chat input
  isActive: boolean; // To focus when activated
}

const ChatInput = forwardRef<HTMLInputElement, ChatInputProps>(({
  inputValue,
  onInputChange,
  onSendMessage,
  onCloseChat,
  isActive,
}, ref) => {
  // Focus the input when it becomes active
  useEffect(() => {
    if (isActive && ref && 'current' in ref && ref.current) {
      // Small timeout to ensure DOM is ready and avoid focus conflicts
      const timer = setTimeout(() => {
        if (ref.current) {
          ref.current.focus();
          // Place cursor at end of text
          const length = ref.current.value.length;
          ref.current.setSelectionRange(length, length);
        }
      }, 100); // Increased timeout for better reliability
      
      return () => clearTimeout(timer);
    }
  }, [isActive, ref]);

  const handleSendIfValid = () => {
    if (inputValue.trim()) {
      // Mark that we should send the message when blur occurs
      if (ref && 'current' in ref && ref.current) {
        (ref.current as any)._shouldSendMessage = true;
        ref.current.blur();
      }
    } else {
      // Just close chat for empty messages
      onCloseChat();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent event bubbling to avoid triggering game controls
    event.stopPropagation();
    
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSendIfValid();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (ref && 'current' in ref && ref.current) {
        ref.current.blur();
      }
    }
    // No need to handle other keys - let them type normally
  };

  // Handle the blur event
  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    // Small delay to handle state updates
    setTimeout(() => {
      const inputEl = ref && 'current' in ref ? ref.current : null;
      if (inputEl && (inputEl as any)._shouldSendMessage) {
        // Reset the flag and send message
        (inputEl as any)._shouldSendMessage = false;
        onSendMessage();
      } else {
        // Otherwise just close chat
        onCloseChat();
      }
    }, 50); // Slightly longer delay for better reliability
  };

  return (
    <input
      ref={ref}
      type="text"
      className={styles.chatInput}
      value={inputValue}
      onChange={(e) => onInputChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      placeholder="Enter message..."
      maxLength={200} // Increased max length
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck="false" // Disabled for cyberpunk aesthetic
      data-is-chat-input="true"
    />
  );
});

// Display name for debugging
ChatInput.displayName = 'ChatInput';

export default ChatInput; 