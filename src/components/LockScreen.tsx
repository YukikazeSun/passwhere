import { useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";

export function LockScreen({ busy, error, onUnlock }: { busy: boolean; error: string; onUnlock: (credential: string) => void }) {
  const [credential, setCredential] = useState("");
  return (
    <main className="lock-screen">
      <form className="unlock-panel" onSubmit={(event) => { event.preventDefault(); if (credential) onUnlock(credential); }}>
        <div className="unlock-mark"><LockKeyhole size={26} /></div>
        <div><h1>我密码呢已锁定</h1><p>输入启动密码或 16 位恢复码</p></div>
        <label className="form-field"><span>密码或恢复码</span><input autoFocus type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="current-password" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button--primary button--full" disabled={!credential || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} 解锁</button>
      </form>
    </main>
  );
}
