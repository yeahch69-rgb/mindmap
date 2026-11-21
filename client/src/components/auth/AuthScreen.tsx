import React, { useState } from 'react';
import { BookMarked, KeyRound, Sparkles, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../common/Button';

interface AuthScreenProps {
  pendingInviteToken?: string | null;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ pendingInviteToken }) => {
  const { login, register, loginDemo } = useAuth();
  const { L, language, setLanguage } = useLanguage();

  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setIsSubmitting(true);
      if (mode === 'LOGIN') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (err: any) {
      setError(err.message || L('요청에 실패했습니다.', 'リクエストに失敗しました。', 'Authentication failed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemo = async () => {
    setError('');
    try {
      setIsSubmitting(true);
      await loginDemo();
    } catch (err: any) {
      setError(err.message || L('데모 시작에 실패했습니다.', 'デモ開始に失敗しました。', 'Demo failed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ivory-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Language Bar */}
        <div className="flex justify-end gap-1">
          {(['ko', 'ja', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setLanguage(lang)}
              className={`px-2.5 py-1 rounded-md text-xs font-bold border transition ${
                language === lang
                  ? 'bg-forest-800 text-white border-forest-900'
                  : 'bg-white text-charcoal-600 border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              {lang === 'ko' ? '한국어' : lang === 'ja' ? '日本語' : 'EN'}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-ivory-300 shadow-lg p-6 space-y-5">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-forest-800 text-white flex items-center justify-center mx-auto shadow-sm">
              <BookMarked className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-charcoal-900">
              {L('프로젝트 마인드맵', 'プロジェクトマインドマップ', 'Project Mindmap')}
            </h1>
            <p className="text-xs text-charcoal-600 leading-relaxed">
              {L(
                '중장기 프로젝트의 의도·대화·턴·마인드맵을 한곳에 기록하고 시각화하는 독립 워크스페이스',
                '中長期プロジェクトの意図・対話・ターン・マインドマップを記録・可視化するワークスペース',
                'Preserve context, track turns, and map your ideas across personal & shared projects'
              )}
            </p>
          </div>

          {pendingInviteToken && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900 flex items-center gap-2 font-bold">
              <KeyRound className="w-4 h-4 shrink-0 text-sky-700" />
              <span>
                {L(
                  '프로젝트 협업 초대가 도착했습니다! 로그인 또는 가입하면 자동으로 참여됩니다.',
                  'プロジェクト招待が届いています。ログイン・登録すると自動で参加します。',
                  'You have a project invite! Sign in or register to join automatically.'
                )}
              </span>
            </div>
          )}

          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ivory-100 border border-ivory-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setMode('LOGIN');
                setError('');
              }}
              className={`py-2 rounded-lg transition ${
                mode === 'LOGIN' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
              }`}
            >
              {L('로그인', 'ログイン', 'Sign In')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('REGISTER');
                setError('');
              }}
              className={`py-2 rounded-lg transition ${
                mode === 'REGISTER' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
              }`}
            >
              {L('회원가입', '新規登録', 'Create Account')}
            </button>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {mode === 'REGISTER' && (
              <div>
                <label className="block font-bold text-charcoal-800 mb-1">
                  {L('이름 (표시명)', '名前（表示名）', 'Display Name')}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={L('예: 소우', '例: 佐藤', 'e.g. Alex')}
                  className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg font-bold text-charcoal-900"
                />
              </div>
            )}

            <div>
              <label className="block font-bold text-charcoal-800 mb-1">
                {L('아이디 또는 이메일', 'ID またはメールアドレス', 'ID or Email')}
              </label>
              <input
                type="text"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={
                  mode === 'LOGIN'
                    ? L('아이디 또는 이메일 (예: admin)', 'ID またはメール (例: admin)', 'ID or email (e.g. admin)')
                    : L('아이디 또는 이메일 (공백 없이 2자 이상)', 'ID またはメール (空白なし2文字以上)', 'ID or email (2+ chars, no spaces)')
                }
                className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg text-charcoal-900"
              />
            </div>

            <div>
              <label className="block font-bold text-charcoal-800 mb-1">
                {L('비밀번호', 'パスワード', 'Password')}
              </label>
              <input
                type="password"
                required
                minLength={mode === 'REGISTER' ? 6 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'REGISTER' ? L('6자 이상', '6文字以上', 'At least 6 characters') : L('비밀번호 입력', 'パスワード入力', 'Enter password')}
                className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg text-charcoal-900"
              />
            </div>

            <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
              {mode === 'LOGIN' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              <span>
                {mode === 'LOGIN'
                  ? L('로그인', 'ログイン', 'Sign In')
                  : L('계정 만들기', 'アカウント作成', 'Create Account')}
              </span>
            </Button>
          </form>

          <div className="pt-3 border-t border-ivory-200 space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleDemo}
              isLoading={isSubmitting}
            >
              <Sparkles className="w-4 h-4" />
              <span>{L('샘플 데이터로 바로 체험하기 (1클릭)', 'サンプルデータで体験（ワンクリック）', 'Try Instant Demo Workspace')}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
