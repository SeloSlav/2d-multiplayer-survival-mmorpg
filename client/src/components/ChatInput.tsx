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
    // Only attempt to focus if the component is active
    if (isActive && ref && 'current' in ref && ref.current) {
      // Small timeout to ensure DOM is ready and avoid focus conflicts
      const timer = setTimeout(() => {
        if (ref.current) {
          ref.current.focus();
          // Place cursor at end of text
          const length = ref.current.value.length;
          ref.current.setSelectionRange(length, length);
        }
      }, 50); // Increased to ensure focus happens after all state updates
      
      return () => clearTimeout(timer);
    }
  }, [isActive, ref]);

  // We'll separate the send message logic from the keyboard event
  const handleSendIfValid = () => {
    if (inputValue.trim()) {
      // Save message value before it gets cleared
      const textToSend = inputValue.trim();
      
      // This is the key change: set a flag that we're sending a message
      // which we'll check in the onBlur handler
      (ref as any).current._shouldSendMessage = true;
      
      // Trigger blur first, which will invoke onBlur handler
      if (ref && 'current' in ref && ref.current) {
        ref.current.blur();
      }
    } else {
      // Just close chat for empty messages
      onCloseChat();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSendIfValid();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (ref && 'current' in ref && ref.current) {
        ref.current.blur();
      }
    }
  };

  // Handle the blur event which will be triggered by both clicking outside 
  // and Enter/Escape key presses
  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    // Slight delay to allow for other state updates
    setTimeout(() => {
      // Check if we should send the message (from Enter key)
      const inputEl = ref && 'current' in ref ? ref.current : null;
      if (inputEl && (inputEl as any)._shouldSendMessage) {
        // Reset the flag
        (inputEl as any)._shouldSendMessage = false;
        // Call the send message callback
        onSendMessage();
      } else {
        // Otherwise just close chat (from clicking outside or Escape)
        onCloseChat();
      }
    }, 10);
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
      placeholder="Press Enter to chat..."
      maxLength={100}
      autoComplete="off"
      spellCheck="true"
      data-is-chat-input="true"
    />
  );
});

// Display name for debugging
ChatInput.displayName = 'ChatInput';

export default ChatInput; 