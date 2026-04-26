import { useState, useEffect, useRef } from 'react';
import appIcon from '../../resources/icon.png';
import ReactMarkdown from 'react-markdown';
import { Spin, Alert } from 'antd';
import { RiseOutlined, FallOutlined, SendOutlined } from '@ant-design/icons';
import { useStockQuote } from '@/hooks/useStockQuote';
import { useStockStore, getChangeColors } from '@/store/useStockStore';
import { formatPercent, formatPriceByMarket } from '@/utils/format';

interface ChatProps {
  /** 当前激活的对话 ID（由 App.tsx 管理） */
  activeConversationId: string | null;
  /** 新建对话时的默认股票代码 */
  initialSymbol?: string;
  /**
   * 当前页面是否处于激活状态（即用户切到了 chat tab）。
   * 由 App.tsx 传入 `activeTab === 'chat'`。
   *
   * 懒加载语义：与 Analysis 页一致，`isActive=false` 时不轮询关联股票的报价，
   * 避免用户在 dashboard / detail / settings tab 时 Chat 仍在后台浪费 API 配额。
   * 默认 true 以保持向后兼容。
   */
  isActive?: boolean;
}

/** 用户消息气泡（右侧，灰色背景，带头像 + 用户名 + 时间） */
const UserBubble = ({
  content,
  username,
  avatar,
  emojiAvatar,
  createdAt,
}: {
  content: string;
  username: string;
  avatar?: string;
  emojiAvatar: string;
  createdAt: string;
}) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
    <div style={{ maxWidth: '70%' }}>
      {/* 用户名 + 时间行（右对齐） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#999' }}>{username}</span>
        <span style={{ fontSize: 11, color: '#b0bcd4' }}>
          {new Date(createdAt).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        {/* 头像 */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: avatar ? 'transparent' : 'rgba(79, 110, 247, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: avatar ? 0 : 16,
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {avatar ? (
            <img src={avatar} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            emojiAvatar
          )}
        </div>
      </div>

      {/* 消息气泡 */}
      <div
        style={{
          background: '#f0f0f0',
          borderRadius: '18px 4px 18px 18px',
          padding: '10px 16px',
          fontSize: 14,
          lineHeight: 1.6,
          color: '#1a1a1a',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </div>
    </div>
  </div>
);

/** AI 回复区域（左侧，参考 HermesWork：头像图标 + 名称标签 + 内容无边框卡片） */
const AssistantBubble = ({ answer, isLoading }: { answer?: string; isLoading?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 24 }}>
    <div style={{ maxWidth: '80%' }}>
      {/* 头像 + 名称行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <img
          src={appIcon}
          alt="StockerChef"
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            flexShrink: 0,
            objectFit: 'contain',
          }}
        />
        <span style={{ fontSize: 12, color: '#999' }}>StockerChef</span>
      </div>

      {/* 回复内容（无边框，直接渲染） */}
      <div style={{ fontSize: 14, lineHeight: 1.7, color: '#1a1a1a', wordBreak: 'break-word' }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#aaa' }}>
            <Spin size="small" />
            <span style={{ fontSize: 13 }}>思考中…</span>
          </div>
        ) : answer ? (
          <div className="markdown-body">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        ) : (
          <span style={{ color: '#bbb', fontSize: 13 }}>暂无回复</span>
        )}
      </div>
    </div>
  </div>
);

/** 顶部股票信息栏（精简版） */
const StockInfoBar = ({
  symbol,
  symbolName,
  accentColor,
  isPositive,
  quote,
  quoteLoading,
  quoteError,
}: {
  symbol: string;
  symbolName?: string;
  accentColor: string;
  isPositive: boolean;
  quote: { price: number; change: number; changePercent: number } | null;
  quoteLoading: boolean;
  quoteError: string | null;
}) => (
  <div
    style={{
      flexShrink: 0,
      padding: '14px 24px 12px',
      borderBottom: '1px solid rgba(79, 110, 247, 0.1)',
      background: 'rgba(248, 250, 255, 0.9)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexWrap: 'wrap',
    }}
  >
    {/* Symbol + 价格 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${accentColor}22, ${accentColor}0d)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 11,
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {symbol.slice(0, 4)}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f1a2e', lineHeight: 1.2 }}>
          {symbol}
          {symbolName && (
            <span style={{ fontWeight: 400, fontSize: 12, color: '#8a9cc8', marginLeft: 6 }}>
              {symbolName}
            </span>
          )}
        </div>
        {quoteLoading ? (
          <Spin size="small" />
        ) : quote ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#1a2e22', letterSpacing: '-0.02em' }}>
              {formatPriceByMarket(quote.price, symbol)}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: accentColor,
                background: isPositive ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
                borderRadius: 6,
                padding: '1px 7px',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {isPositive ? <RiseOutlined style={{ fontSize: 10 }} /> : <FallOutlined style={{ fontSize: 10 }} />}
              {formatPercent(quote.changePercent)}
            </span>
          </div>
        ) : quoteError ? (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>行情获取失败</span>
        ) : null}
      </div>
    </div>

  </div>
);

/** 针对股票的备选分析问题卡片数据 */
const getStockPrompts = (symbol: string, symbolName?: string) => {
  const displayName = symbolName || symbol;
  return [
    {
      icon: '📊',
      iconBg: 'rgba(79, 110, 247, 0.1)',
      iconColor: '#4f6ef7',
      title: '技术面分析',
      description: `${displayName} 当前的 RSI 和均线信号如何？是否处于超买或超卖区间？`,
    },
    {
      icon: '💰',
      iconBg: 'rgba(34, 197, 94, 0.1)',
      iconColor: '#16a34a',
      title: '基本面评估',
      description: `${displayName} 的估值水平如何？市盈率、市净率是否合理？`,
    },
    {
      icon: '📰',
      iconBg: 'rgba(245, 158, 11, 0.1)',
      iconColor: '#d97706',
      title: '近期催化剂',
      description: `${displayName} 最近有哪些重要新闻或事件可能影响股价走势？`,
    },
    {
      icon: '⚖️',
      iconBg: 'rgba(168, 85, 247, 0.1)',
      iconColor: '#9333ea',
      title: '风险评估',
      description: `持有 ${displayName} 当前面临哪些主要风险？有哪些需要关注的风险点？`,
    },
    {
      icon: '🎯',
      iconBg: 'rgba(239, 68, 68, 0.1)',
      iconColor: '#dc2626',
      title: '支撑与压力',
      description: `${displayName} 近期的关键支撑位和压力位在哪里？`,
    },
    {
      icon: '🔮',
      iconBg: 'rgba(20, 184, 166, 0.1)',
      iconColor: '#0d9488',
      title: '操作建议',
      description: `综合来看，${displayName} 当前适合买入、持有还是减仓？理由是什么？`,
    },
  ];
};

/** Hero 欢迎页（空状态时展示） */
const HeroWelcome = ({
  symbol,
  symbolName,
  onSelectPrompt,
}: {
  symbol: string;
  symbolName?: string;
  onSelectPrompt: (prompt: string) => void;
}) => {
  const prompts = getStockPrompts(symbol, symbolName);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 0 24px',
      }}
    >
      {/* ── 中央 Hero 区域 ── */}
      <img
        src={appIcon}
        alt="StockerChef"
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          marginBottom: 20,
          objectFit: 'contain',
          boxShadow: '0 8px 32px rgba(79, 110, 247, 0.25)',
        }}
      />

      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: '#0f1a2e',
          letterSpacing: '-0.03em',
          marginBottom: 8,
          textAlign: 'center',
        }}
      >
        不只看行情，更懂投资
      </div>

      <div
        style={{
          fontSize: 14,
          color: '#8a9cc8',
          marginBottom: 36,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        AI 实时分析股票走势，帮你看清机会、规避风险
      </div>

      {/* ── 备选问题卡片 3×2 网格 ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          width: '100%',
          maxWidth: 720,
        }}
      >
        {prompts.map((prompt) => (
          <div
            key={prompt.title}
            onClick={() => onSelectPrompt(prompt.description)}
            style={{
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(79, 110, 247, 0.1)',
              borderRadius: 16,
              padding: '18px 16px',
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.transform = 'translateY(-2px)';
              el.style.boxShadow = '0 8px 24px rgba(79, 110, 247, 0.14)';
              el.style.borderColor = 'rgba(79, 110, 247, 0.25)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.transform = 'translateY(0)';
              el.style.boxShadow = 'none';
              el.style.borderColor = 'rgba(79, 110, 247, 0.1)';
            }}
          >
            {/* 图标 */}
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: prompt.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                marginBottom: 12,
              }}
            >
              {prompt.icon}
            </div>

            {/* 标题 */}
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#0f1a2e',
                marginBottom: 6,
                lineHeight: 1.3,
              }}
            >
              {prompt.title}
            </div>

            {/* 描述 */}
            <div
              style={{
                fontSize: 12,
                color: '#6b7fa8',
                lineHeight: 1.6,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {prompt.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** 底部输入框（圆角边框包裹整个输入区域） */
const ChatInputBar = ({
  value,
  symbol,
  onChange,
  onSend,
  inputRef,
  disabled,
}: {
  value: string;
  symbol: string;
  onChange: (v: string) => void;
  onSend: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
}) => (
  <div
    style={{
      flexShrink: 0,
      padding: '12px 32px 20px',
      background: 'rgba(255, 255, 255, 0.9)',
      backdropFilter: 'blur(12px)',
    }}
  >
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: 20,
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          transition: 'border-color 0.2s, box-shadow 0.2s',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={symbol ? `描述你对 ${symbol} 的问题或想法…` : '输入你的问题或想法…'}
          rows={2}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          style={{
            width: '100%',
            padding: '14px 16px 8px',
            fontSize: 14,
            color: '#1a1a1a',
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
            border: 'none',
            background: 'transparent',
            fontFamily: 'inherit',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px 10px',
          }}
        >
          <span style={{ fontSize: 11, color: '#bbb' }}>
            Enter 发送 · Shift+Enter 换行
          </span>
          <button
            onClick={onSend}
            disabled={!value.trim() || disabled}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: value.trim() && !disabled ? '#1a1a1a' : '#e0e0e0',
              border: 'none',
              cursor: value.trim() && !disabled ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
              flexShrink: 0,
            }}
          >
            <SendOutlined style={{ color: '#fff', fontSize: 13 }} />
          </button>
        </div>
      </div>
    </div>
  </div>
);

const Chat = ({ activeConversationId, initialSymbol, isActive = true }: ChatProps) => {
  const {
    conversations,
    activeConversationId: storeActiveId,
    createConversation,
    appendMessage,
    refreshInterval,
    symbolNames,
    colorMode,
    userProfile,
  } = useStockStore();

  const [messageInput, setMessageInput] = useState('');
  const [isWaitingReply, setIsWaitingReply] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 当前激活的对话（优先用 prop 传入的 id，否则用 store 的）
  const resolvedConversationId = activeConversationId ?? storeActiveId;
  const activeConversation = conversations.find((c) => c.id === resolvedConversationId) ?? null;
  const currentMessages = activeConversation?.messages ?? [];

  // 当前对话关联的股票（用于 StockInfoBar）
  const symbol = activeConversation?.symbol || initialSymbol || '';

  // 切换对话时滚动到底部
  useEffect(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, 50);
  }, [resolvedConversationId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 懒加载：仅当用户切到 chat tab 且当前对话有关联股票时才轮询报价
  const { quote, loading: quoteLoading, error: quoteError } = useStockQuote(
    symbol,
    refreshInterval * 1000,
    isActive && !!symbol,
  );

  const { up: upColor, down: downColor } = getChangeColors(colorMode);
  const isPositive = quote ? quote.change >= 0 : true;
  const accentColor = isPositive ? upColor : downColor;

  const handleSendMessage = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || isWaitingReply) return;
    setMessageInput('');
    setIsWaitingReply(true);

    // 如果没有激活的对话，先创建一个新对话
    let conversationId = resolvedConversationId;
    if (!conversationId) {
      conversationId = await createConversation(symbol || undefined);
    }

    // 追加用户消息
    await appendMessage(conversationId, { role: 'user', content: trimmed });
    setTimeout(scrollToBottom, 100);

    // 接入真实 AI 接口后，在此处发起请求并追加 assistant 消息
    // 目前模拟 1.5s 后返回占位回复
    setTimeout(async () => {
      await appendMessage(conversationId!, {
        role: 'assistant',
        content: `感谢你的提问！目前 AI 分析功能正在接入中，你的问题已记录：\n\n> ${trimmed}`,
      });
      setIsWaitingReply(false);
      setTimeout(scrollToBottom, 100);
    }, 1500);
  };

  // 没有任何对话时，显示 Hero 欢迎页
  if (!activeConversation) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* 顶部股票信息栏（有 symbol 时展示） */}
        {symbol && (
          <StockInfoBar
            symbol={symbol}
            symbolName={symbolNames[symbol]}
            accentColor={accentColor}
            isPositive={isPositive}
            quote={quote}
            quoteLoading={quoteLoading}
            quoteError={quoteError}
          />
        )}

        {/* Hero 欢迎页 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 8px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <HeroWelcome
              symbol={symbol || 'BABA'}
              symbolName={symbolNames[symbol] || ''}
              onSelectPrompt={(prompt) => setMessageInput(prompt)}
            />
          </div>
        </div>

        {/* 底部输入框 */}
        <ChatInputBar
          value={messageInput}
          symbol={symbol}
          onChange={setMessageInput}
          onSend={handleSendMessage}
          inputRef={inputRef}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── 顶部股票信息栏 ── */}
      {symbol && (
        <StockInfoBar
          symbol={symbol}
          symbolName={symbolNames[symbol]}
          accentColor={accentColor}
          isPositive={isPositive}
          quote={quote}
          quoteLoading={quoteLoading}
          quoteError={quoteError}
        />
      )}

      {/* ── 对话标题栏 ── */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 24px 8px',
          borderBottom: '1px solid rgba(79, 110, 247, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#2d3a52', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeConversation.title}
        </span>
        <span style={{ fontSize: 11, color: '#a0aec8', flexShrink: 0 }}>
          {currentMessages.filter((m) => m.role === 'user').length} 条问题
        </span>
      </div>

      {/* ── 消息流区域 ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 8px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

          {/* 消息列表 */}
          {currentMessages.map((msg) => (
            <div key={msg.id} id={`msg-${msg.id}`} style={{ padding: '4px 0' }}>
              {msg.role === 'user' ? (
                <UserBubble
                  content={msg.content}
                  username={userProfile.username}
                  avatar={userProfile.avatar}
                  emojiAvatar={userProfile.emojiAvatar}
                  createdAt={msg.createdAt}
                />
              ) : (
                <AssistantBubble
                  answer={msg.content || undefined}
                  isLoading={false}
                />
              )}
            </div>
          ))}

          {/* 报价错误提示 */}
          {quoteError && (
            <Alert
              message={quoteError}
              type="warning"
              showIcon
              style={{ marginBottom: 16, borderRadius: 12 }}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── 底部输入框 ── */}
      <ChatInputBar
        value={messageInput}
        symbol={symbol}
        onChange={setMessageInput}
        onSend={handleSendMessage}
        inputRef={inputRef}
      />
    </div>
  );
};

export default Chat;
