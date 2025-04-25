import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatMessageHistory from './ChatMessageHistory';
import ChatInput from './ChatInput';
import { DbConnection, Message as SpacetimeDBMessage, Player as SpacetimeDBPlayer } from '../generated'; // Assuming types
import styles from './Chat.module.css';

interface ChatProps {
  connection: DbConnection | null;
  messages: Map<string, SpacetimeDBMessage>; // Receive messages map
  players: Map<string, SpacetimeDBPlayer>; // Receive players map
  isChatting: boolean; // Receive chat state
  setIsChatting: (isChatting: boolean) => void; // Receive state setter
}

const Chat: React.FC<ChatProps> = ({ connection, messages, players, isChatting, setIsChatting }) => {
  const [inputValue, setInputValue] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<number>(0);

  // Track new messages and scroll to bottom
  useEffect(() => {
    const currentCount = messages.size;
    
    // Still keep track of message count for potential future features
    // But no longer using it to set hasUnreadMessages
    
    // Always scroll to bottom when messages change
    if (messageEndRef.current) {
      messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    
    lastMessageCountRef.current = currentCount;
  }, [messages, isChatting]);

  // Define handleCloseChat first for dependency ordering
  const handleCloseChat = useCallback(() => {
    setIsChatting(false);
    setInputValue('');
    // Explicitly blur any active element to ensure proper game controls
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Focus on document body to ensure key events work
    document.body.focus();
  }, [setIsChatting]);

  // Handle placeholder click
  const handlePlaceholderClick = useCallback(() => {
    setIsChatting(true);
    // Focus will be handled by the useEffect in ChatInput
  }, [setIsChatting]);

  // Global keyboard event handler
  const handleGlobalKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't process if modifier keys are pressed
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    
    // Check what element has focus
    const activeElement = document.activeElement;
    const isInputFocused = 
      activeElement?.tagName === 'INPUT' || 
      activeElement?.tagName === 'TEXTAREA' ||
      activeElement?.getAttribute('contenteditable') === 'true';
      
    // Skip if we're focused on some other input that isn't our chat
    const isChatInputFocused = activeElement === chatInputRef.current;
    if (isInputFocused && !isChatInputFocused) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      
      // Only toggle chat open if not already chatting and not focused on another input
      if (!isChatting && !isInputFocused) {
        setIsChatting(true);
      }
      // If chatting, the Enter key is handled by ChatInput component
      }
    
    // Close chat with Escape if it's open
    if (event.key === 'Escape' && isChatting) {
         event.preventDefault();
      handleCloseChat();
    }
  }, [isChatting, setIsChatting, handleCloseChat]);

  // Message sending handler
  const handleSendMessage = useCallback(() => {
    if (!connection?.reducers || !inputValue.trim()) return;

    try {
      // Send message to server
      connection.reducers.sendMessage(inputValue.trim());
      
      // Clear input value
      setInputValue('');
      
      // Close chat UI
      setIsChatting(false);
      
      // No need for explicit blur handling here anymore
      // The ChatInput component now handles this through its blur event
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }, [connection, inputValue, setIsChatting]);

  // Register/unregister global keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handleGlobalKeyDown]);

  // Create class for container - removed hasUnread class
  const containerClass = isChatting ? `${styles.chatContainer} ${styles.active}` : styles.chatContainer;

  return (
    <div className={containerClass}>
      {/* Always render message history for gameplay awareness */}
      <ChatMessageHistory 
        messages={messages} 
        players={players}
        messageEndRef={messageEndRef as React.RefObject<HTMLDivElement>}
      />
      
      {/* Render either the input or the placeholder */}
      {isChatting ? (
        <ChatInput
          ref={chatInputRef}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSendMessage={handleSendMessage}
          onCloseChat={handleCloseChat}
          isActive={isChatting}
        />
      ) : (
        <div 
          className={styles.chatPlaceholder} 
          onClick={handlePlaceholderClick}
        >
          Press Enter to chat...
        </div>
      )}
    </div>
  );
};

export default Chat; 