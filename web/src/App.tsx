import { Composer } from './components/Composer.tsx';
import { MessageList } from './components/MessageList.tsx';
import { useChat } from './useChat.ts';

export function App() {
  const { messages, loading, send } = useChat();
  return (
    <div className="app">
      <header>People Chat</header>
      <MessageList messages={messages} loading={loading} />
      <Composer disabled={loading} onSend={send} />
    </div>
  );
}
