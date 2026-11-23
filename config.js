// Supabase 연결 정보 (공개돼도 되는 값만). service_role / secret 키는 절대 넣지 마세요.
// Supabase 대시보드 › Connect (또는 Project Settings › API Keys)의 Project URL과 Publishable key
window.DDW_CONFIG = {
  url: 'https://ovnagheqsygclposiemh.supabase.co',
  anonKey: 'sb_publishable_TJJdQnu5xm-W-AowBFgTwQ_4Kd18OSo',
  // 웹 푸시 공개 키(VAPID public key). 비워 두면 알림 받기 카드가 안 보임. 개인 키는 여기 말고 Supabase Edge Function 비밀값에만
  vapidKey: '',
};
