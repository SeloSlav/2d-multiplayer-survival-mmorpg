import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatMessageHistory from './ChatMessageHistory';
import ChatInput from './ChatInput';
import { DbConnection, Message as SpacetimeDBMessage, Player as SpacetimeDBPlayer, PrivateMessage as SpacetimeDBPrivateMessage, EventContext } from '../generated'; // Assuming types
import styles from './Chat.module.css';

interface ChatProps {
  connection: DbConnection | null;
  messages: Map<string, SpacetimeDBMessage>; // Receive messages map
  players: Map<string, SpacetimeDBPlayer>; // Receive players map
  isChatting: boolean; // Receive chat state
  setIsChatting: (isChatting: boolean) => void; // Receive state setter
  localPlayerIdentity: string | undefined; // Changed from string | null
}

const Chat: React.FC<ChatProps> = ({ connection, messages, players, isChatting, setIsChatting, localPlayerIdentity }) => {
  console.log("[Chat Component Render] Props - Connection:", !!connection, "LocalPlayerIdentity:", localPlayerIdentity);
  const [inputValue, setInputValue] = useState('');
  const [privateMessages, setPrivateMessages] = useState<Map<string, SpacetimeDBPrivateMessage>>(new Map());
  const chatInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<number>(0);
  const privateMessageSubscriptionRef = useRef<any | null>(null); // Changed back to any for now

  // Subscribe to private messages and set up callbacks
  useEffect(() => {
    console.log("[Chat] PrivateMsgEffect: Running. Connection:", !!connection, "LocalPlayerId:", localPlayerIdentity);

    // If no connection or no local identity, we can't subscribe.
    // Ensure any existing subscription is cleaned up.
    if (!connection || !localPlayerIdentity) {
      if (privateMessageSubscriptionRef.current) {
        console.log("[Chat] PrivateMsgEffect: Cleaning up old subscription (no connection/identity).");
        try {
          privateMessageSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] PrivateMsgEffect: Error unsubscribing stale subscription:", e);
        }
        privateMessageSubscriptionRef.current = null;
      }
      setPrivateMessages(new Map()); // Clear local private messages
      return;
    }

    // Proceed with subscription as we have a connection and identity
    const query = `SELECT * FROM private_message WHERE recipient_identity = '${localPlayerIdentity}'`;
    console.log("[Chat] PrivateMsgEffect: Attempting to subscribe with query:", query);

    const subHandle = connection.subscriptionBuilder()
      .onApplied(() => console.log("[Chat] PrivateMsgEffect: Subscription APPLIED for query:", query))
      .onError((errorContext) => console.error("[Chat] PrivateMsgEffect: Subscription ERROR:", errorContext))
      .subscribe([query]);
    privateMessageSubscriptionRef.current = subHandle;
    console.log("[Chat] PrivateMsgEffect: Subscription handle stored.");

    const handlePrivateMessageInsert = (ctx: EventContext, msg: SpacetimeDBPrivateMessage) => {
      console.log("[Chat] PrivateMsgEffect: Private message INSERTED:", msg, "Context:", ctx);
      setPrivateMessages(prev => new Map(prev).set(String(msg.id), msg));
    };

    const handlePrivateMessageDelete = (ctx: EventContext, msg: SpacetimeDBPrivateMessage) => {
      console.log("[Chat] PrivateMsgEffect: Private message DELETED:", msg, "Context:", ctx);
      setPrivateMessages(prev => {
        const next = new Map(prev);
        next.delete(String(msg.id));
        return next;
      });
    };
    
    const privateMessageTable = connection.db.privateMessage; 

    if (privateMessageTable) {
      console.log("[Chat] PrivateMsgEffect: Attaching listeners to privateMessageTable.");
      privateMessageTable.onInsert(handlePrivateMessageInsert);
      privateMessageTable.onDelete(handlePrivateMessageDelete);
    } else {
      console.error("[Chat] PrivateMsgEffect: privateMessage table NOT FOUND in DB bindings!");
    }

    // Cleanup function for this effect
    return () => {
      console.log("[Chat] PrivateMsgEffect: Cleanup initiated. Unsubscribing and removing listeners.");
      if (privateMessageSubscriptionRef.current) {
        console.log("[Chat] PrivateMsgEffect: Calling unsubscribe() on stored handle.");
        try {
          privateMessageSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] PrivateMsgEffect: Error during unsubscribe:", e);
        }
        privateMessageSubscriptionRef.current = null;
      }
      if (privateMessageTable) {
        console.log("[Chat] PrivateMsgEffect: Removing listeners from privateMessageTable.");
        privateMessageTable.removeOnInsert(handlePrivateMessageInsert);
        privateMessageTable.removeOnDelete(handlePrivateMessageDelete);
      }
    };
  }, [connection, localPlayerIdentity]); // Dependencies: re-run if connection or identity changes

  // Track new messages (public or private) and scroll to bottom
  useEffect(() => {
    const currentPublicCount = messages.size;
    const currentPrivateCount = privateMessages.size;
    const totalCurrentCount = currentPublicCount + currentPrivateCount;
    
    if (totalCurrentCount > lastMessageCountRef.current || (isChatting && totalCurrentCount > 0)) {
        if (messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }
    lastMessageCountRef.current = totalCurrentCount;
  }, [messages, privateMessages, isChatting]);

  // Define handleCloseChat first for dependency ordering
  const handleCloseChat = useCallback(() => {
    setIsChatting(false);
    setInputValue('');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
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
        privateMessages={privateMessages}
        players={players}
        localPlayerIdentity={localPlayerIdentity}
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