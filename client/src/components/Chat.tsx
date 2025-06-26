import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatMessageHistory from './ChatMessageHistory';
import ChatInput from './ChatInput';
import { DbConnection, Message as SpacetimeDBMessage, Player as SpacetimeDBPlayer, PrivateMessage as SpacetimeDBPrivateMessage, EventContext } from '../generated'; // Assuming types
import styles from './Chat.module.css';
import sovaIcon from '../assets/ui/sova.png';
import { kikashiService } from '../services/kikashiService';
import { openaiService } from '../services/openaiService';
import { buildGameContext, type GameContextBuilderProps } from '../utils/gameContextBuilder';

interface ChatProps {
  connection: DbConnection | null;
  messages: Map<string, SpacetimeDBMessage>; // Receive messages map
  players: Map<string, SpacetimeDBPlayer>; // Receive players map
  isChatting: boolean; // Receive chat state
  setIsChatting: (isChatting: boolean) => void; // Receive state setter
  localPlayerIdentity: string | undefined; // Changed from string | null
  onSOVAMessageAdderReady?: (addMessage: (message: { id: string; text: string; isUser: boolean; timestamp: Date }) => void) => void;
  // Game context props for SOVA
  worldState?: any;
  localPlayer?: any;
  itemDefinitions?: Map<string, any>;
  activeEquipments?: Map<string, any>;
  inventoryItems?: Map<string, any>;
}

type ChatTab = 'global' | 'sova';

// SOVA Message Component - moved outside to prevent re-renders
const SOVAMessage: React.FC<{message: {id: string, text: string, isUser: boolean, timestamp: Date}}> = React.memo(({ message }) => (
  <div className={`${styles.message} ${message.isUser ? styles.sovaMessageUser : styles.sovaMessageBot}`}>
    <div className={styles.messageHeader}>
      <span className={`${styles.playerName} ${message.isUser ? styles.sovaPlayerNameUser : styles.sovaPlayerNameBot}`}>
        {message.isUser ? 'You' : 'SOVA'}
      </span>
      <span className={styles.timestamp}>
        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
    <div className={styles.messageContent}>
      {message.text}
    </div>
  </div>
));

const Chat: React.FC<ChatProps> = ({ connection, messages, players, isChatting, setIsChatting, localPlayerIdentity, onSOVAMessageAdderReady, worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems }) => {
  // console.log("[Chat Component Render] Props - Connection:", !!connection, "LocalPlayerIdentity:", localPlayerIdentity);
  const [inputValue, setInputValue] = useState('');
  const [privateMessages, setPrivateMessages] = useState<Map<string, SpacetimeDBPrivateMessage>>(new Map());
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatTab>('global');
  const [sovaMessages, setSovaMessages] = useState<Array<{id: string, text: string, isUser: boolean, timestamp: Date}>>([]);
  const [sovaInputValue, setSovaInputValue] = useState('');
  const [showPerformanceReport, setShowPerformanceReport] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const sovaInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const sovaMessageEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<number>(0);
  const privateMessageSubscriptionRef = useRef<any | null>(null); // Changed back to any for now
  const isAnimating = useRef(false);

  // Define handleCloseChat first for dependency ordering
  const handleCloseChat = useCallback(() => {
    setIsChatting(false);
    setInputValue('');
    setSovaInputValue('');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.focus();
  }, [setIsChatting]);

  // Handle tab switching
  const handleTabSwitch = useCallback((tab: ChatTab) => {
    setActiveTab(tab);
  }, []);

  // Toggle minimize/maximize with smooth animation
  const toggleMinimized = useCallback(() => {
    if (isAnimating.current) return; // Prevent rapid toggling during animation
    
    isAnimating.current = true;
    
    if (!isMinimized) {
      // Minimizing: Close chat input first, wait for animation, then minimize
      if (isChatting) {
        setIsChatting(false);
        setInputValue('');
        setSovaInputValue('');
      }
      
      // Wait a bit for chat input to close smoothly before sliding out
      setTimeout(() => {
        setIsMinimized(true);
        setTimeout(() => { isAnimating.current = false; }, 400); // Match transition duration
      }, 100);
    } else {
      // Maximizing: Show container first, then enable interactions
      setIsMinimized(false);
      setTimeout(() => { isAnimating.current = false; }, 400); // Match transition duration
    }
  }, [isMinimized, isChatting, setIsChatting]);

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
    const isSOVAInputFocused = activeElement === sovaInputRef.current;
    if (isInputFocused && !isChatInputFocused && !isSOVAInputFocused) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      
      // Only toggle chat open if not already chatting and not focused on another input and not minimized
      if (!isChatting && !isInputFocused && !isMinimized) {
        setIsChatting(true);
      }
      // If chatting, the Enter key is handled by ChatInput component
      }
    
    // Close chat with Escape if it's open
    if (event.key === 'Escape' && isChatting) {
         event.preventDefault();
      handleCloseChat();
    }
  }, [isChatting, setIsChatting, handleCloseChat, isMinimized]);

  // Handle SOVA message sending with voice synthesis and game context
  const handleSendSOVAMessage = useCallback(async () => {
    if (!sovaInputValue.trim()) return;

    const userMessageText = sovaInputValue.trim();

    // Add user message to SOVA chat immediately
    const userMessage = {
      id: `user-${Date.now()}`,
      text: userMessageText,
      isUser: true,
      timestamp: new Date()
    };
    
    setSovaMessages(prev => [...prev, userMessage]);
    setSovaInputValue('');

    try {
      // Build game context for SOVA AI
      const gameContext = buildGameContext({
        worldState,
        localPlayer,
        itemDefinitions,
        activeEquipments,
        inventoryItems,
        localPlayerIdentity,
      });

      console.log('[Chat] Generating SOVA AI response with game context for:', userMessageText);
      
      // Generate SOVA AI response using OpenAI service with game context
      const aiResponse = await openaiService.generateSOVAResponse({
        userMessage: userMessageText,
        playerName: localPlayerIdentity,
        gameContext,
      });

      if (aiResponse.success && aiResponse.response) {
        console.log('[Chat] SOVA AI response generated:', aiResponse.response);

        // Add SOVA's text response to chat
        const botResponse = {
          id: `sova-${Date.now()}`,
          text: aiResponse.response,
          isUser: false,
          timestamp: new Date()
        };
        setSovaMessages(prev => [...prev, botResponse]);

        // Try to synthesize and play voice response
        try {
          const voiceResult = await kikashiService.synthesizeVoice({
            text: aiResponse.response,
            voiceStyle: 'robot2'
          });
          
          if (voiceResult.success && voiceResult.audioUrl) {
            await kikashiService.playAudio(voiceResult.audioUrl);
            console.log('[Chat] SOVA voice response played successfully');
          } else {
            console.error('[Chat] Voice synthesis failed:', voiceResult.error);
          }
        } catch (voiceError) {
          console.error('[Chat] Failed to play SOVA voice response:', voiceError);
        }

      } else {
        // Fallback response if AI generation fails
        const fallbackResponse = {
          id: `sova-${Date.now()}`,
          text: `SOVA: AI response error - ${aiResponse.error || 'Unknown error'}. Message received: "${userMessageText}". Please try again.`,
          isUser: false,
          timestamp: new Date()
        };
        setSovaMessages(prev => [...prev, fallbackResponse]);
        console.error('[Chat] SOVA AI response failed:', aiResponse.error);
      }
    } catch (error) {
      // Error handling for API failures
      const errorResponse = {
        id: `sova-${Date.now()}`,
        text: `SOVA: System error occurred. Message received: "${userMessageText}". Please try again later.`,
        isUser: false,
        timestamp: new Date()
      };
      setSovaMessages(prev => [...prev, errorResponse]);
      console.error('[Chat] SOVA API error:', error);
    }

    // Clear input and maintain chat focus
    if (sovaInputRef.current) {
      sovaInputRef.current.focus();
    }
  }, [sovaInputValue, setIsChatting, worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems, localPlayerIdentity]);

  // Handle performance report generation
  const handleGenerateReport = useCallback(() => {
    kikashiService.logPerformanceReport();
    setShowPerformanceReport(true);
  }, []);

  // Handle copying report to clipboard
  const handleCopyReport = useCallback(async () => {
    try {
      const report = kikashiService.generateFormattedReport();
      await navigator.clipboard.writeText(report);
      
      // Add a message to SOVA chat confirming the copy
      const confirmMessage = {
        id: `sova-report-${Date.now()}`,
        text: 'Performance report copied to clipboard! You can now share it with the Kikashi API team.',
        isUser: false,
        timestamp: new Date()
      };
      setSovaMessages(prev => [...prev, confirmMessage]);
      
      setShowPerformanceReport(false);
    } catch (error) {
      console.error('[Chat] Failed to copy report:', error);
      
      // Add error message to SOVA chat
      const errorMessage = {
        id: `sova-error-${Date.now()}`,
        text: 'Failed to copy report to clipboard. Check console for the report text.',
        isUser: false,
        timestamp: new Date()
      };
      setSovaMessages(prev => [...prev, errorMessage]);
    }
  }, []);

  // Handle placeholder click
  const handlePlaceholderClick = useCallback(() => {
    setIsChatting(true);
    // Focus will be handled by the useEffect in ChatInput
  }, [setIsChatting]);

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

  // Create the addSOVAMessage function to pass to parent
  const addSOVAMessage = useCallback((message: { id: string; text: string; isUser: boolean; timestamp: Date }) => {
    // Safety check to prevent null/undefined messages
    if (!message || !message.id || !message.text) {
      console.error('[Chat] Invalid SOVA message received:', message);
      return;
    }
    
    console.log('[Chat] Adding SOVA message:', message);
    setSovaMessages(prev => [...prev, message]);
    
    // Auto-switch to SOVA tab when voice messages are added
    if (message.id.includes('voice')) {
      console.log('[Chat] Auto-switching to SOVA tab for voice message');
      setActiveTab('sova');
    }
  }, []);

  // Subscribe to private messages and set up callbacks
  useEffect(() => {
    // console.log("[Chat] PrivateMsgEffect: Running. Connection:", !!connection, "LocalPlayerId:", localPlayerIdentity);

    // If no connection or no local identity, we can't subscribe.
    // Ensure any existing subscription is cleaned up.
    if (!connection || !localPlayerIdentity) {
      if (privateMessageSubscriptionRef.current) {
        // console.log("[Chat] PrivateMsgEffect: Cleaning up old subscription (no connection/identity).");
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
    // console.log("[Chat] PrivateMsgEffect: Attempting to subscribe with query:", query);

    const subHandle = connection.subscriptionBuilder()
      // .onApplied(() => console.log("[Chat] PrivateMsgEffect: Subscription APPLIED for query:", query))
      .onError((errorContext) => console.error("[Chat] PrivateMsgEffect: Subscription ERROR:", errorContext))
      .subscribe([query]);
    privateMessageSubscriptionRef.current = subHandle;
    // console.log("[Chat] PrivateMsgEffect: Subscription handle stored.");

    const handlePrivateMessageInsert = (ctx: EventContext, msg: SpacetimeDBPrivateMessage) => {
      // console.log("[Chat] PrivateMsgEffect: Private message INSERTED:", msg, "Context:", ctx);
      setPrivateMessages(prev => new Map(prev).set(String(msg.id), msg));
    };

    const handlePrivateMessageDelete = (ctx: EventContext, msg: SpacetimeDBPrivateMessage) => {
      // console.log("[Chat] PrivateMsgEffect: Private message DELETED:", msg, "Context:", ctx);
      setPrivateMessages(prev => {
        const next = new Map(prev);
        next.delete(String(msg.id));
        return next;
      });
    };
    
    const privateMessageTable = connection.db.privateMessage; 

    if (privateMessageTable) {
      // console.log("[Chat] PrivateMsgEffect: Attaching listeners to privateMessageTable.");
      privateMessageTable.onInsert(handlePrivateMessageInsert);
      privateMessageTable.onDelete(handlePrivateMessageDelete);
    } else {
      console.error("[Chat] PrivateMsgEffect: privateMessage table NOT FOUND in DB bindings!");
    }

    // Cleanup function for this effect
    return () => {
      // console.log("[Chat] PrivateMsgEffect: Cleanup initiated. Unsubscribing and removing listeners.");
      if (privateMessageSubscriptionRef.current) {
        // console.log("[Chat] PrivateMsgEffect: Calling unsubscribe() on stored handle.");
        try {
          privateMessageSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] PrivateMsgEffect: Error during unsubscribe:", e);
        }
        privateMessageSubscriptionRef.current = null;
      }
      if (privateMessageTable) {
        // console.log("[Chat] PrivateMsgEffect: Removing listeners from privateMessageTable.");
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

  // Track new SOVA messages and scroll to bottom
  useEffect(() => {
    if (activeTab === 'sova' && sovaMessages.length > 0 && sovaMessageEndRef.current) {
      sovaMessageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sovaMessages, activeTab]);

  // Call the parent callback with our function
  useEffect(() => {
    if (onSOVAMessageAdderReady) {
      console.log('[Chat] Calling onSOVAMessageAdderReady with addSOVAMessage function');
      onSOVAMessageAdderReady(addSOVAMessage);
    } else {
      console.log('[Chat] onSOVAMessageAdderReady not available');
    }
  }, [onSOVAMessageAdderReady, addSOVAMessage]);

  // Register/unregister global keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handleGlobalKeyDown]);

  // Minimized view - just a chat icon
  if (isMinimized) {
    return (
      <div 
        className={styles.sovaButtonMinimized}
        onClick={toggleMinimized}
        data-chat-container="true"
      >
        <img 
          src={sovaIcon} 
          alt="SOVA" 
          className={styles.sovaIcon}
        />
      </div>
    );
  }

  // Create class for container with slide animation states
  const containerClass = isChatting ? `${styles.chatContainer} ${styles.active}` : styles.chatContainer;
  const animationClass = isMinimized ? styles.chatContainerMinimized : styles.chatContainerVisible;

  return (
    <div 
      className={`${containerClass} ${animationClass}`} 
      data-chat-container="true"
    >
      {/* Minimize button */}
      <div 
        className={styles.minimizeButton}
        onClick={toggleMinimized}
      >
        −
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabContainer}>
        <button 
          className={`${styles.tab} ${activeTab === 'global' ? styles.activeTab : ''}`}
          onClick={() => handleTabSwitch('global')}
        >
          Global
        </button>
        <button 
          className={`${styles.tab} ${activeTab === 'sova' ? styles.activeTab : ''}`}
          onClick={() => handleTabSwitch('sova')}
        >
          SOVA
        </button>
      </div>

      {/* Conditional Content Based on Active Tab */}
      {activeTab === 'global' ? (
        <>
          {/* Global Chat - Always render message history for gameplay awareness */}
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
        </>
      ) : (
        <>
          {/* SOVA Chat */}
          <div className={styles.messageHistory}>
            {sovaMessages.length === 0 ? (
              <div className={styles.sovaWelcomeMessage}>
                Welcome to SOVA AI Assistant
                <br />
                Ask me anything about the game!
              </div>
            ) : (
              sovaMessages.filter(message => message && message.id).map(message => (
                <SOVAMessage key={message.id} message={message} />
              ))
            )}
            <div ref={sovaMessageEndRef} />
          </div>
          
          {/* SOVA Performance Report Button */}
          <div className={styles.performanceReportContainer}>
            <button
              onClick={handleGenerateReport}
              className={styles.performanceReportButton}
            >
              API PERFORMANCE REPORT
            </button>
          </div>
          
          {/* SOVA Input */}
          {isChatting ? (
            <ChatInput
              ref={sovaInputRef}
              inputValue={sovaInputValue}
              onInputChange={setSovaInputValue}
              onSendMessage={handleSendSOVAMessage}
              onCloseChat={handleCloseChat}
              isActive={isChatting}
            />
          ) : (
            <div 
              className={styles.chatPlaceholder} 
              onClick={handlePlaceholderClick}
            >
              Ask SOVA anything...
            </div>
          )}
        </>
      )}

      {/* Performance Report Modal */}
      {showPerformanceReport && (
        <div className={styles.performanceReportModal}>
          <div className={styles.performanceReportContent}>
            <div className={styles.performanceReportTitle}>
              🎤 KIKASHI API PERFORMANCE REPORT
            </div>
            
            <pre className={styles.performanceReportText}>
              {kikashiService.generateFormattedReport()}
            </pre>
            
            <div className={styles.performanceReportActions}>
              <button
                onClick={handleCopyReport}
                className={styles.modalButtonPrimary}
              >
                COPY TO CLIPBOARD
              </button>
              
              <button
                onClick={() => setShowPerformanceReport(false)}
                className={styles.modalButtonSecondary}
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat; 