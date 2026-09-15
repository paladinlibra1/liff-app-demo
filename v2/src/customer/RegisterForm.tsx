import { useState } from "react";
import { registerMember, type MyProfile } from "./api";
import { isValidPhone, PHONE_RULE_MSG } from "../shared/phone";
import { birthdayError } from "../shared/birthday";

/**
 * 會員綁定表單
 *
 * 只問三件事：姓名、電話、生日。綁定的意義是「把這個 LINE 身分對應到
 * 店裡的一個人」，其餘資料（備註、介紹人）是店家自己記的，不該問客人。
 *
 * 電話要問，是因為店家常常先幫沒有 LINE 的客人建過檔——後端會拿電話去
 * 接上那筆舊資料，客人的歷史才不會斷掉（見 worker/bookings.ts）。
 *
 * 這個表單同時被兩個地方用：
 *   - 獨立的綁定頁（RegisterApp）
 *   - 「我的預約」發現還沒綁定時擋在前面的那一關
 */
export default function RegisterForm({
  accessToken, onDone,
}: {
  accessToken: string;
  onDone: (member: MyProfile) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (busy) return;                     // 防連點
    setErr("");

    if (!name.trim()) return setErr("請填姓名");
    if (!isValidPhone(phone)) return setErr(PHONE_RULE_MSG);
    if (!birthday) return setErr("請填生日");
    const bErr = birthdayError(birthday);
    if (bErr) return setErr(bErr);

    setBusy(true);
    try {
      const { member } = await registerMember(accessToken, {
        name: name.trim(), phone: phone.trim(), birthday,
      });
      onDone(member);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">會員綁定</div>
      <p className="sub">
        第一次使用，請先留下基本資料。綁定之後才能查看與取消自己的預約，
        下次預約也會自動帶出這些資料，不用重打。
      </p>

      <div className="field">
        <label htmlFor="r-name">姓名</label>
        <input
          id="r-name" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="請填真實姓名" autoComplete="name"
        />
      </div>

      <div className="field">
        <label htmlFor="r-phone">聯絡電話</label>
        <input
          id="r-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
          type="tel" inputMode="tel" maxLength={16}
          placeholder="09xxxxxxxx" autoComplete="tel"
        />
      </div>

      <div className="field">
        <label htmlFor="r-birthday">生日</label>
        <input
          id="r-birthday" type="date" value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
        />
      </div>

      {err && <div className="msg err">{err}</div>}

      <button disabled={busy} onClick={submit}>
        {busy ? "⏳ 綁定中…" : "✅ 完成綁定"}
      </button>
    </div>
  );
}
