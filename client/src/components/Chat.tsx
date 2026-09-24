import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatMessageHistory from './ChatMessageHistory';
import ChatInput from './ChatInput';
import { DbConnection, EventContext } from '../generated';
import type { Message as SpacetimeDBMessage, Player as SpacetimeDBPlayer, PrivateMessage as SpacetimeDBPrivateMessage, TeamMessage as SpacetimeDBTeamMessage, LastWhisperFrom, Recipe } from '../generated/types';
import { Identity } from 'spacetimedb';
import styles from './Chat.module.css';
import sovaIcon from '../assets/ui/sova.png';
import { openaiService } from '../services/openaiService';
import { buildGameContext, type GameContextBuilderProps } from '../utils/gameContextBuilder';
import apiPerformanceService from '../services/apiPerformanceService';
import { kokoroService } from '../services/kokoroService';
import { parseCraftIntent, resolveRecipeByName, getCraftFeedback } from '../utils/craftIntentParser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear } from '@fortawesome/free-solid-svg-icons';
import { useGameUI } from '../contexts/GameUIContext';
import { useChatRuntimeData } from '../engine/react/selectors';

interface ChatProps {
  connection: DbConnection | null;
  onSOVAMessageAdderReady?: (addMessage: (message: { id: string; text: string; isUser: boolean; timestamp: Date; flashTab?: boolean }) => void) => void;
  // Mobile support - when true, chat visibility is controlled externally
  isMobile?: boolean;
  isMobileChatOpen?: boolean; // Controls visibility on mobile instead of internal isMinimized
  // Callback for /s (say) command - emits local speech bubble
  onSayCommand?: (message: string) => void;
  onTitleSelect?: (titleId: string | null) => void;
}

type ChatTab = 'global' | 'sova' | 'team';
type ChatMode = 'global' | 'team' | null; // null means no prefix (defaults to global)

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

const Chat: React.FC<ChatProps> = ({ connection, onSOVAMessageAdderReady, isMobile = false, isMobileChatOpen = false, onSayCommand, onTitleSelect }) => {
  const { isChatting, setIsChatting } = useGameUI();
  const localPlayerIdentity = connection?.identity?.toHexString();
  const playerIdentity = connection?.identity ?? null;
  const {
    messages,
    players,
    worldState,
    localPlayer,
    itemDefinitions,
    activeEquipments,
    inventoryItems,
    recipes,
    matronageMembers,
    matronages,
    playerStats,
    playerAchievements,
    achievementDefinitions,
  } = useChatRuntimeData(localPlayerIdentity ?? null);
  // console.log("[Chat Component Render] Props - Connection:", !!connection, "LocalPlayerIdentity:", localPlayerIdentity);
  const [inputValue, setInputValue] = useState('');
  const [privateMessages, setPrivateMessages] = useState<Map<string, SpacetimeDBPrivateMessage>>(new Map());
  const [teamMessages, setTeamMessages] = useState<Map<string, SpacetimeDBTeamMessage>>(new Map());
  const [lastWhisperFrom, setLastWhisperFrom] = useState<LastWhisperFrom | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatTab>('global');
  const MAX_SOVA_MESSAGES = 200; // Cap to prevent unbounded memory growth
  const [sovaMessages, setSovaMessages] = useState<Array<{id: string, text: string, isUser: boolean, timestamp: Date}>>([]);
  const [sovaInputValue, setSovaInputValue] = useState('');
  const [showPerformanceReport, setShowPerformanceReport] = useState(false);
  const [isSOVALoading, setIsSOVALoading] = useState(false);
  const [isTitleMenuOpen, setIsTitleMenuOpen] = useState(false);
  // Chat mode persistence - remember last used mode (/g or /t)
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    const saved = localStorage.getItem('lastChatMode');
    return (saved === 'global' || saved === 'team') ? saved : null;
  });
  const chatInputRef = useRef<HTMLInputElement>(null);
  const sovaInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const sovaMessageEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<number>(0);
  const privateMessageSubscriptionRef = useRef<any | null>(null); // Changed back to any for now
  const teamMessageSubscriptionRef = useRef<any | null>(null);
  const lastWhisperSubscriptionRef = useRef<any | null>(null);
  const isAnimating = useRef(false);
  const titleMenuRef = useRef<HTMLDivElement>(null);
  
  // SOVA tab flash state - for drawing attention to the tab
  const [isSovaTabFlashing, setIsSovaTabFlashing] = useState(false);
  const sovaTabFlashTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    // When switching to team tab, set chat mode to team
    if (tab === 'team') {
      setChatMode('team');
      localStorage.setItem('lastChatMode', 'team');
    } else if (tab === 'global') {
      // When switching to global tab, set chat mode to global
      setChatMode('global');
      localStorage.setItem('lastChatMode', 'global');
    }
    // SOVA tab doesn't affect chat mode
  }, []);

  // Toggle minimize/maximize with smooth animation
  const toggleMinimized = useCallback(() => {
    if (isAnimating.current) return; // Prevent rapid toggling during animation
    setIsTitleMenuOpen(false);
    
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
    
    // CRITICAL FIX: Close chat immediately to unblock game controls
    setIsChatting(false);
    
    // Show loading state
    setIsSOVALoading(true);

    try {
      // Phase 5: Craft intent - intercept before LLM
      const craftIntent = parseCraftIntent(userMessageText);
      if (craftIntent && recipes && itemDefinitions && inventoryItems) {
        const recipe = resolveRecipeByName(craftIntent.recipeName, recipes, itemDefinitions);
        if (recipe) {
          const feedback = getCraftFeedback(
            recipe,
            craftIntent.quantity,
            inventoryItems,
            itemDefinitions,
            playerIdentity ?? null
          );

          if (feedback.success && connection?.reducers) {
            try {
              connection.reducers.startCraftingMultiple({ recipeId: BigInt(recipe.recipeId), quantityToCraft: craftIntent.quantity });
            } catch (err) {
              console.error('[Chat] Craft reducer error:', err);
              feedback.message = `Crafting failed: ${(err as Error).message}`;
            }
          }

          const botResponse = {
            id: `sova-${Date.now()}`,
            text: feedback.message,
            isUser: false,
            timestamp: new Date()
          };
          setSovaMessages(prev => [...prev, botResponse]);
          setIsSOVALoading(false);
          return;
        } else {
          const unknownResponse = {
            id: `sova-${Date.now()}`,
            text: `I don't know how to craft "${craftIntent.recipeName}". Try a different item name or check the crafting menu.`,
            isUser: false,
            timestamp: new Date()
          };
          setSovaMessages(prev => [...prev, unknownResponse]);
          setIsSOVALoading(false);
          return;
        }
      }

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
        connection,
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
        
        // Hide loading state after response received
        setIsSOVALoading(false);

        // Try to synthesize and play voice response using Kokoro TTS
        try {
          const voiceResult = await kokoroService.synthesizeVoice({
            text: aiResponse.response,
            voiceStyle: 'sova'
          });
          
          if (voiceResult.success && voiceResult.audioUrl) {
            await kokoroService.playAudio(voiceResult.audioUrl);
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
        setIsSOVALoading(false);
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
      setIsSOVALoading(false);
      console.error('[Chat] SOVA API error:', error);
    }

    // Don't refocus - let player continue playing
    // Chat is already closed via setIsChatting(false) above
  }, [sovaInputValue, setIsChatting, worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems, localPlayerIdentity]);

  // Handle performance report generation
  const handleGenerateReport = useCallback(() => {
    console.log('[Chat] Generating unified API performance report...');
    setShowPerformanceReport(true);
  }, []);

  // Handle copying report to clipboard
  const handleCopyReport = useCallback(async () => {
    try {
      const report = apiPerformanceService.generateFormattedReport();
      await navigator.clipboard.writeText(report);
      
      // Add a message to SOVA chat confirming the copy
      const confirmMessage = {
        id: `sova-report-${Date.now()}`,
        text: 'SOVA performance report copied to clipboard! Contains AI response, transcription, and Kokoro TTS timings.',
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

  const { currentTitle, availableTitles } = React.useMemo(() => {
    if (!localPlayerIdentity || !playerStats || !playerAchievements || !achievementDefinitions) {
      return { currentTitle: null as string | null, availableTitles: [] as Array<{ id: string; title: string; description: string }> };
    }

    const stats = playerStats.get(localPlayerIdentity);
    const currentTitleId = stats?.activeTitleId ?? null;
    const seenTitleIds = new Set<string>();
    const titles: Array<{ id: string; title: string; description: string }> = [];

    playerAchievements.forEach((achievement: any) => {
      if (achievement.playerId?.toHexString?.() !== localPlayerIdentity) return;
      const definition = achievementDefinitions.get(achievement.achievementId);
      const rewardTitle = definition?.titleReward;
      if (!rewardTitle || seenTitleIds.has(rewardTitle)) return;
      seenTitleIds.add(rewardTitle);
      titles.push({
        id: rewardTitle,
        title: rewardTitle,
        description: definition.name || 'Achievement Title',
      });
    });

    return { currentTitle: currentTitleId, availableTitles: titles };
  }, [localPlayerIdentity, playerStats, playerAchievements, achievementDefinitions]);

  const handleTitleSelection = useCallback((titleId: string | null) => {
    onTitleSelect?.(titleId);
    setIsTitleMenuOpen(false);
  }, [onTitleSelect]);

  // Get list of online player names for autocomplete
  const onlinePlayerNames = React.useMemo(() => {
    return Array.from(players.values())
      .filter(p => p.isOnline && !p.isDead)
      .map(p => p.username)
      .sort();
  }, [players]);

  // Auto-expand /r command to /w <username> when user types it
  useEffect(() => {
    const trimmed = inputValue.trim();
    
    // Check if user just typed "/r " (with space after)
    if ((trimmed === '/r' || trimmed === '/reply') && inputValue.endsWith(' ')) {
      if (lastWhisperFrom) {
        // Auto-expand to /w <username>
        const expandedCommand = `/w ${lastWhisperFrom.lastWhisperFromUsername} `;
        setInputValue(expandedCommand);
        console.log(`[Chat] Auto-expanded /r to: ${expandedCommand}`);
      } else {
        console.log('[Chat] No one has whispered you yet - /r cannot be expanded');
      }
    }
  }, [inputValue, lastWhisperFrom]);

  // Message sending handler
  const handleSendMessage = useCallback(() => {
    if (!connection?.reducers || !inputValue.trim()) return;

    let trimmedInput = inputValue.trim();
    
    // Handle /s (say) command - client-side only speech bubble
    if (trimmedInput.startsWith('/s ') || trimmedInput === '/s') {
      const sayText = trimmedInput.substring(3).trim();
      if (sayText) {
        // Emit local speech bubble
        if (onSayCommand) {
          onSayCommand(sayText);
        }
        // Clear input and close chat
        setInputValue('');
        setIsChatting(false);
        return;
      } else {
        // Empty /s command - just close chat
        setInputValue('');
        setIsChatting(false);
        return;
      }
    }
    
    // Handle chat mode persistence
    if (trimmedInput.startsWith('/')) {
      const parts = trimmedInput.split(/\s+/);
      const command = parts[0].toLowerCase();
      
      // Check if user is switching chat modes
      if (command === '/g' || command === '/global') {
        setChatMode('global');
        localStorage.setItem('lastChatMode', 'global');
        // Switch to global tab if not already there
        if (activeTab !== 'global') {
          setActiveTab('global');
        }
        // Remove the command prefix and send the rest
        trimmedInput = parts.slice(1).join(' ');
        if (!trimmedInput) {
          // Just switching mode, don't send empty message
          setInputValue('');
          setIsChatting(false);
          return;
        }
      } else if (command === '/t' || command === '/team') {
        setChatMode('team');
        localStorage.setItem('lastChatMode', 'team');
        // Switch to team tab if not already there
        if (activeTab !== 'team') {
          setActiveTab('team');
        }
        // Remove the command prefix and send the rest
        trimmedInput = parts.slice(1).join(' ');
        if (!trimmedInput) {
          // Just switching mode, don't send empty message
          setInputValue('');
          setIsChatting(false);
          return;
        }
      }
      
      // Validate /w command has enough arguments
      if ((command === '/w' || command === '/whisper') && parts.length < 3) {
        console.error('[Chat] Usage: /w <playername> <message>');
        // Still send to server to get proper error message
      }
      
      // Validate /r command has message
      if ((command === '/r' || command === '/reply') && parts.length < 2) {
        console.error('[Chat] Usage: /r <message>');
        // Still send to server to get proper error message
      }
      
      // Log command usage for debugging
      console.log(`[Chat] Command used: ${command}`);
    } else {
      // No command prefix - apply persistent chat mode
      if (chatMode === 'team') {
        // Prepend /t to the message
        trimmedInput = `/t ${trimmedInput}`;
      }
      // If chatMode is 'global' or null, send as-is (defaults to global)
    }

    try {
      // Send message to server
      connection.reducers.sendMessage({ text: trimmedInput });
      
      // Clear input value
      setInputValue('');
      
      // Close chat UI
      setIsChatting(false);
      
      // No need for explicit blur handling here anymore
      // The ChatInput component now handles this through its blur event
    } catch (error) {
      console.error("[Chat] Error sending message:", error);
    }
  }, [connection, inputValue, setIsChatting, chatMode, onSayCommand, activeTab]);

  // Create the addSOVAMessage function to pass to parent
  const addSOVAMessage = useCallback((message: { id: string; text: string; isUser: boolean; timestamp: Date; flashTab?: boolean }) => {
    // Safety check to prevent null/undefined messages
    if (!message || !message.id || !message.text) {
      console.error('[Chat] Invalid SOVA message received:', message);
      return;
    }
    
    console.log('[Chat] Adding SOVA message:', message.id, message.isUser ? '(user)' : '(bot)', message.flashTab ? '(with flash)' : '');
    setSovaMessages(prev => {
      // Streaming replies update the same bubble as new text arrives.
      if (prev.some(m => m.id === message.id)) {
        return prev.map(m => m.id === message.id ? { ...m, text: message.text } : m);
      }
      const updated = [...prev, { id: message.id, text: message.text, isUser: message.isUser, timestamp: message.timestamp }];
      // Cap messages to prevent unbounded memory growth
      if (updated.length > MAX_SOVA_MESSAGES) {
        return updated.slice(-MAX_SOVA_MESSAGES);
      }
      return updated;
    });
    
    // Auto-switch to SOVA tab when voice messages are added OR when flashTab is requested
    // This ensures users see SOVA's important messages (tutorials, warnings, lore, etc.)
    if (message.id.includes('voice') || message.flashTab) {
      console.log('[Chat] Auto-switching to SOVA tab for important message');
      setActiveTab('sova');
    }
    
    // Flash the SOVA tab to draw attention if requested
    if (message.flashTab) {
      console.log('[Chat] Flashing SOVA tab to draw attention');
      // Clear any existing flash timeout
      if (sovaTabFlashTimeoutRef.current) {
        clearTimeout(sovaTabFlashTimeoutRef.current);
      }
      setIsSovaTabFlashing(true);
      // Stop flashing after animation completes (3 sweeps at 1s each = 3s)
      sovaTabFlashTimeoutRef.current = setTimeout(() => {
        setIsSovaTabFlashing(false);
      }, 3000);
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
    
    const privateMessageTable = connection.db.private_message; 

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

  // Subscribe to LastWhisperFrom table to track who last whispered to us
  useEffect(() => {
    if (!connection || !localPlayerIdentity) {
      if (lastWhisperSubscriptionRef.current) {
        try {
          lastWhisperSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] LastWhisperEffect: Error unsubscribing:", e);
        }
        lastWhisperSubscriptionRef.current = null;
      }
      setLastWhisperFrom(null);
      return;
    }

    // Subscribe to our LastWhisperFrom record
    const query = `SELECT * FROM last_whisper_from WHERE player_id = '${localPlayerIdentity}'`;
    
    const subHandle = connection.subscriptionBuilder()
      .onError((errorContext) => console.error("[Chat] LastWhisperEffect: Subscription ERROR:", errorContext))
      .subscribe([query]);
    lastWhisperSubscriptionRef.current = subHandle;

    const handleLastWhisperUpdate = (ctx: EventContext, oldRecord: LastWhisperFrom, newRecord: LastWhisperFrom) => {
      setLastWhisperFrom(newRecord);
    };

    const handleLastWhisperInsert = (ctx: EventContext, record: LastWhisperFrom) => {
      setLastWhisperFrom(record);
    };

    const lastWhisperTable = connection.db.last_whisper_from;
    if (lastWhisperTable) {
      lastWhisperTable.onInsert(handleLastWhisperInsert);
      lastWhisperTable.onUpdate(handleLastWhisperUpdate);
    }

    // Load initial value if it exists
    if (lastWhisperTable) {
      const playerIdentity = Identity.fromString(localPlayerIdentity);
      const existingRecord = lastWhisperTable.playerId.find(playerIdentity);
      if (existingRecord) {
        setLastWhisperFrom(existingRecord);
      }
    }

    return () => {
      if (lastWhisperSubscriptionRef.current) {
        try {
          lastWhisperSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] LastWhisperEffect: Error during cleanup:", e);
        }
        lastWhisperSubscriptionRef.current = null;
      }
      if (lastWhisperTable) {
        lastWhisperTable.removeOnInsert(handleLastWhisperInsert);
        lastWhisperTable.removeOnUpdate(handleLastWhisperUpdate);
      }
    };
  }, [connection, localPlayerIdentity]);

  // Subscribe to team (matronage) messages
  useEffect(() => {
    if (!connection || !localPlayerIdentity) {
      if (teamMessageSubscriptionRef.current) {
        try {
          teamMessageSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] TeamMsgEffect: Error unsubscribing:", e);
        }
        teamMessageSubscriptionRef.current = null;
      }
      setTeamMessages(new Map());
      return;
    }

    // Get the player's matronage ID from matronageMembers
    const membership = matronageMembers?.get(localPlayerIdentity);
    if (!membership) {
      // Player is not in a matronage, clear team messages
      setTeamMessages(new Map());
      return;
    }

    const matronageId = membership.matronageId;
    
    // Subscribe to team messages for this matronage
    const query = `SELECT * FROM team_message WHERE matronage_id = ${matronageId}`;
    
    const subHandle = connection.subscriptionBuilder()
      .onError((errorContext) => console.error("[Chat] TeamMsgEffect: Subscription ERROR:", errorContext))
      .subscribe([query]);
    teamMessageSubscriptionRef.current = subHandle;

    const handleTeamMessageInsert = (ctx: EventContext, msg: SpacetimeDBTeamMessage) => {
      setTeamMessages(prev => new Map(prev).set(String(msg.id), msg));
    };

    const handleTeamMessageDelete = (ctx: EventContext, msg: SpacetimeDBTeamMessage) => {
      setTeamMessages(prev => {
        const next = new Map(prev);
        next.delete(String(msg.id));
        return next;
      });
    };
    
    const teamMessageTable = connection.db.team_message;
    if (teamMessageTable) {
      teamMessageTable.onInsert(handleTeamMessageInsert);
      teamMessageTable.onDelete(handleTeamMessageDelete);
    } else {
      console.warn("[Chat] TeamMsgEffect: teamMessage table NOT FOUND in DB bindings");
    }

    return () => {
      if (teamMessageSubscriptionRef.current) {
        try {
          teamMessageSubscriptionRef.current.unsubscribe();
        } catch (e) {
          console.warn("[Chat] TeamMsgEffect: Error during cleanup:", e);
        }
        teamMessageSubscriptionRef.current = null;
      }
      if (teamMessageTable) {
        teamMessageTable.removeOnInsert(handleTeamMessageInsert);
        teamMessageTable.removeOnDelete(handleTeamMessageDelete);
      }
    };
  }, [connection, localPlayerIdentity, matronageMembers]);

  // Track new messages - only scroll to bottom on initial open (ChatMessageHistory handles smart scroll)
  // This effect now only tracks message counts for other purposes, not auto-scrolling
  useEffect(() => {
    // Calculate count based on active tab
    let totalCurrentCount = 0;
    if (activeTab === 'global') {
      totalCurrentCount = messages.size + privateMessages.size;
    } else if (activeTab === 'team') {
      totalCurrentCount = teamMessages.size;
    } else {
      // SOVA tab - don't scroll based on message count
      return;
    }
    
    // NOTE: Auto-scrolling is now handled by ChatMessageHistory with smart scroll
    // Only update the count reference - ChatMessageHistory handles actual scrolling
    lastMessageCountRef.current = totalCurrentCount;
  }, [messages, privateMessages, teamMessages, activeTab]);

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

  useEffect(() => {
    if (!isTitleMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!titleMenuRef.current?.contains(event.target as Node)) {
        setIsTitleMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [isTitleMenuOpen]);

  // Mobile mode: visibility controlled by parent via isMobileChatOpen
  if (isMobile) {
    // On mobile, if chat is not open, don't render anything (handled by MobileControlBar)
    if (!isMobileChatOpen) {
      return null;
    }
    // On mobile when open, always show full chat (skip minimized state)
  } else {
    // Desktop: Minimized view - just a chat icon
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
  }

  // Create class for container with slide animation states
  const containerClass = isChatting ? `${styles.chatContainer} ${styles.active}` : styles.chatContainer;
  const animationClass = isMinimized ? styles.chatContainerMinimized : styles.chatContainerVisible;

  return (
    <div 
      className={`${containerClass} ${animationClass} ${isMobile ? styles.mobileChat : ''}`} 
      data-chat-container="true"
    >
      {/* Minimize button - only show on desktop */}
      {!isMobile && (
      <div className={styles.chatControls} ref={titleMenuRef}>
        <button
          type="button"
          className={styles.titleGearButton}
          onClick={(event) => {
            event.stopPropagation();
            setIsTitleMenuOpen((prev) => !prev);
          }}
          title="Select active title"
        >
          <FontAwesomeIcon icon={faGear} />
        </button>
        {isTitleMenuOpen && (
          <div className={styles.titleContextMenu}>
            <button
              type="button"
              className={`${styles.titleMenuOption} ${!currentTitle ? styles.activeTitleOption : ''}`}
              onClick={() => handleTitleSelection(null)}
            >
              No Title
            </button>
            {availableTitles.length > 0 ? (
              availableTitles.map((title) => (
                <button
                  type="button"
                  key={title.id}
                  className={`${styles.titleMenuOption} ${currentTitle === title.id ? styles.activeTitleOption : ''}`}
                  onClick={() => handleTitleSelection(title.id)}
                  title={title.description}
                >
                  {title.title}
                </button>
              ))
            ) : (
              <div className={styles.titleMenuEmpty}>No titles unlocked</div>
            )}
          </div>
        )}
        <button
          type="button"
          className={styles.minimizeButton}
          onClick={toggleMinimized}
        >
          −
        </button>
      </div>
      )}

      {/* Tab Navigation */}
      <div className={styles.tabContainer}>
        <button 
          className={`${styles.tab} ${activeTab === 'global' ? styles.activeTab : ''}`}
          onClick={() => handleTabSwitch('global')}
        >
          Global
        </button>
        <button 
          className={`${styles.tab} ${activeTab === 'sova' ? styles.activeTab : ''} ${isSovaTabFlashing && activeTab !== 'sova' ? styles.sovaTabFlash : ''}`}
          onClick={() => {
            handleTabSwitch('sova');
            // Stop flashing when user clicks on SOVA tab
            if (isSovaTabFlashing) {
              setIsSovaTabFlashing(false);
              if (sovaTabFlashTimeoutRef.current) {
                clearTimeout(sovaTabFlashTimeoutRef.current);
              }
            }
          }}
        >
          SOVA
        </button>
        {matronageMembers?.get(localPlayerIdentity || '') && (
          <button 
            className={`${styles.tab} ${activeTab === 'team' ? styles.activeTab : ''}`}
            onClick={() => handleTabSwitch('team')}
          >
            Team
          </button>
        )}
      </div>

      {/* Conditional Content Based on Active Tab */}
      {activeTab === 'global' ? (
        <>
          {/* Global Chat - Always render message history for gameplay awareness */}
          <ChatMessageHistory
            messages={messages}
            privateMessages={privateMessages}
            teamMessages={new Map()} // Don't show team messages in global tab
            players={players}
            localPlayerIdentity={localPlayerIdentity}
            messageEndRef={messageEndRef as React.RefObject<HTMLDivElement>}
            matronageMembers={matronageMembers}
            matronages={matronages}
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
              onlinePlayerNames={onlinePlayerNames}
              placeholder={chatMode === 'team' ? 'Type message (Team mode) or /g for global...' : 'Type message or /t for team, /s to say locally...'}
            />
          ) : (
            <div 
              className={styles.chatPlaceholder} 
              onClick={handlePlaceholderClick}
            >
              {chatMode === 'team' ? 'Press Enter to chat (Team mode)...' : 'Press Enter to chat...'}
            </div>
          )}
        </>
      ) : activeTab === 'team' ? (
        <>
          {/* Team Chat - Only show team messages */}
          <ChatMessageHistory
            messages={new Map()} // Don't show global messages in team tab
            privateMessages={new Map()} // Don't show private messages in team tab
            teamMessages={teamMessages}
            players={players}
            localPlayerIdentity={localPlayerIdentity}
            messageEndRef={messageEndRef as React.RefObject<HTMLDivElement>}
            matronageMembers={matronageMembers}
            matronages={matronages}
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
              onlinePlayerNames={onlinePlayerNames}
              placeholder="Type message (Team) or /g for global, /s to say locally..."
            />
          ) : (
            <div 
              className={styles.chatPlaceholder} 
              onClick={handlePlaceholderClick}
            >
              Press Enter to chat (Team)...
            </div>
          )}
        </>
      ) : (
        <>
          {/* SOVA Chat */}
          <div className={styles.messageHistory}>
            {sovaMessages.length === 0 ? (
              <div className={styles.sovaWelcomeMessage}>
                <span style={{ fontWeight: 600 }}>SOVA Online.</span>
                <br />
                Recon initiated. What intel do you require, agent?
              </div>
            ) : (
              <>
                {sovaMessages.filter(message => message && message.id).map(message => (
                  <SOVAMessage key={message.id} message={message} />
                ))}
                
                {/* Loading Animation */}
                {isSOVALoading && (
                  <div className={`${styles.message} ${styles.sovaMessageBot}`}>
                    <div className={styles.messageHeader}>
                      <span className={`${styles.playerName} ${styles.sovaPlayerNameBot}`}>
                        SOVA
                      </span>
                    </div>
                    <div className={styles.messageContent}>
                      <div className={styles.sovaLoadingDots}>
                        <span className={styles.dot}>●</span>
                        <span className={styles.dot}>●</span>
                        <span className={styles.dot}>●</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={sovaMessageEndRef} />
          </div>
          
          {/* SOVA Performance Report Button - Only show in development */}
          {/* {import.meta.env.MODE !== 'production' && (
            <div className={styles.performanceReportContainer}>
              <button
                onClick={handleGenerateReport}
                className={styles.performanceReportButton}
              >
                API PERFORMANCE REPORT
              </button>
            </div>
          )} */}
          
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

      {/* Performance Report Modal - Only show in development */}
      {import.meta.env.MODE !== 'production' && showPerformanceReport && (
        <div className={styles.performanceReportModal}>
          <div className={styles.performanceReportContent}>
            <div className={styles.performanceReportTitle}>
              📊 SOVA API PERFORMANCE REPORT
            </div>
            
            <pre className={styles.performanceReportText}>
              {apiPerformanceService.generateFormattedReport()}
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
