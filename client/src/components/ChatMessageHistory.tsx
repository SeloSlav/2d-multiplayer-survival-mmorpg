import React, { useEffect, useRef, RefObject, useMemo } from 'react';
import { Message as SpacetimeDBMessage, Player as SpacetimeDBPlayer, PrivateMessage as SpacetimeDBPrivateMessage } from '../generated'; // Assuming Message and Player types are generated
import { Identity } from '@clockworklabs/spacetimedb-sdk'; // Import Identity directly from SDK
import styles from './Chat.module.css';

// Combined message type for internal use
type CombinedMessage = (SpacetimeDBMessage | SpacetimeDBPrivateMessage) & { isPrivate?: boolean; senderDisplayNameOverride?: string };

interface ChatMessageHistoryProps {
  messages: Map<string, SpacetimeDBMessage>; // Pass the messages map
  privateMessages: Map<string, SpacetimeDBPrivateMessage>; // Add privateMessages prop
  players: Map<string, SpacetimeDBPlayer>; // Pass players map to look up names
  localPlayerIdentity: string | undefined; // Changed from string | null
  messageEndRef: RefObject<HTMLDivElement>; // Add the ref parameter
}

const ChatMessageHistory: React.FC<ChatMessageHistoryProps> = ({ messages, privateMessages, players, localPlayerIdentity, messageEndRef }) => {
  const historyRef = useRef<HTMLDivElement>(null);

  // Memoize and sort all messages (public and private)
  const allSortedMessages = useMemo(() => {
    const combined: CombinedMessage[] = [];

    messages.forEach(msg => combined.push(msg));
    privateMessages.forEach(msg => combined.push({ ...msg, isPrivate: true }));

    combined.sort((a, b) => {
      const timeA = a.sent?.microsSinceUnixEpoch ?? 0n;
      const timeB = b.sent?.microsSinceUnixEpoch ?? 0n;
      if (timeA < timeB) return -1;
      if (timeA > timeB) return 1;
      return 0;
    });
    return combined;
  }, [messages, privateMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [allSortedMessages]); // Re-run effect when combined messages map changes

  const getPlayerName = (identity: Identity): string => {
    const identityHex = identity.toHexString();
    const player = players.get(identityHex);
    return player?.username ?? identityHex.substring(0, 8); // Fallback to short ID
  };

  // Function to determine if a sender is the module (SYSTEM for public messages)
  // This is a placeholder. A robust way would be to get the module identity from the connection.
  const isSenderSystemModule = (senderIdentity: Identity): boolean => {
    // Crude check: if not a known player and not the local player, assume system for public messages.
    // This is NOT robust. Ideally, compare with actual module identity if available.
    const senderHex = senderIdentity.toHexString();
    if (!players.has(senderHex) && senderHex !== localPlayerIdentity) {
        // Further check: ensure it's not just an unknown player by checking if a player object COULD exist
        // This is still not perfect. Best is to have module identity.
        return true; // Tentatively assume system if sender is not in players map
    }
    return false;
  };

  return (
    <div ref={historyRef} className={styles.messageHistory}>
      {allSortedMessages.map(msg => {
        let senderName: string;
        let messageText = msg.text;
        let messageStyle: React.CSSProperties = {};
        const systemMessageColor = '#FFD700'; // Gold color for system messages
        let isSystemMsg = false;

        if (msg.isPrivate) {
          const privateMsg = msg as SpacetimeDBPrivateMessage;
          if (privateMsg.senderDisplayName === 'SYSTEM') {
            senderName = 'SYSTEM';
            isSystemMsg = true;
          } else {
            senderName = privateMsg.senderDisplayName;
          }
        } else {
          const publicMsg = msg as SpacetimeDBMessage;
          if (isSenderSystemModule(publicMsg.sender)) {
            senderName = 'SYSTEM';
            isSystemMsg = true;
          } else {
            senderName = getPlayerName(publicMsg.sender);
          }
        }

        if (isSystemMsg) {
            messageStyle = { color: systemMessageColor, fontStyle: 'italic' };
        }

        // Use msg.id if it exists on both types and is unique, otherwise use index or generate key
        const key = msg.id ? msg.id.toString() : Math.random().toString(); 

        return (
          <div key={key} className={styles.message} style={messageStyle}>
            <span className={styles.senderName}>{senderName}:</span>
            <span className={styles.messageText}>{messageText}</span>
          </div>
        );
      })}
      <div ref={messageEndRef} />
    </div>
  );
};

export default ChatMessageHistory; 