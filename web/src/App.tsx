import { Composer } from './components/Composer.tsx';
import { Header } from './components/Header.tsx';
import { MessageList } from './components/MessageList.tsx';
import { useChat } from './useChat.ts';

export function App() {
  const { messages, loading, send } = useChat();
  return (
    <div className="app">
      <Header />
      <MessageList messages={messages} loading={loading} />
      <Composer disabled={loading} onSend={send} />
    </div>
  );
}
