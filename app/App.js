import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Image, ScrollView, StyleSheet,
  Animated, Easing, SafeAreaView, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import DocumentScanner from 'react-native-document-scanner-plugin';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const API_URL = process.env.EXPO_PUBLIC_RECEIPT_API || 'http://localhost:8000/receipt';

// 세그먼트로 전환하는 프로바이더 (서버 PROVIDERS 키와 일치해야 함)
const PROVIDERS = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'gemma3', label: 'Gemma4 26B' },
  { key: 'gemma4', label: 'Gemma4 31B' },
  { key: 'vision', label: 'Vision' },      // 한글 OCR(원문)
  { key: 'textract', label: 'Textract' },  // 영문 전용
  { key: 'docai', label: 'Doc AI' },       // 전용 파서
];

const labelOf = (k) => PROVIDERS.find((p) => p.key === k)?.label || k;
const fmt = (n) => (n != null ? n.toLocaleString() : '—'); // 숫자 or 대시
const USD_KRW = 1380;

const C = {
  bg: '#F6F5F1', surface: '#FFFFFF', ink: '#17130E', muted: '#8C867B',
  line: '#EBE8E1', accent: '#0E9F6E', accentDeep: '#0B8457', accentSoft: '#E6F6EF',
  warn: '#E8590C', warnSoft: '#FCEEE3', scrim: 'rgba(246,245,241,0.94)',
};

const haptic = (t) => { try { Haptics.notificationAsync(t); } catch {} };

// ── 진입 애니메이션 래퍼 (opacity + 위로 슬라이드) ──
function FadeInUp({ delay = 0, y = 18, children, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [y, 0] }) }],
    }]}>{children}</Animated.View>
  );
}

// ── 프레스 시 눌리는 프라이머리 버튼 ──
function PrimaryButton({ label, onPress, disabled }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  return (
    <Pressable onPressIn={() => to(0.96)} onPressOut={() => to(1)} onPress={onPress} disabled={disabled}>
      <Animated.View style={[styles.btnShadow, { transform: [{ scale: s }], opacity: disabled ? 0.5 : 1 }]}>
        <LinearGradient colors={[C.accent, C.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>
          <Text style={styles.btnText}>{label}</Text>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

// ── 스캔 프레임 위를 오가는 스캔 라인 ──
function ScanLine({ height }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(y, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })).start();
  }, []);
  return (
    <Animated.View style={{
      position: 'absolute', left: 14, right: 14, height: 2,
      transform: [{ translateY: y.interpolate({ inputRange: [0, 0.5, 1], outputRange: [10, height - 12, 10] }) }],
      opacity: y.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
    }}>
      <LinearGradient colors={['transparent', C.accent, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 2 }} />
    </Animated.View>
  );
}

// ── 인식 성공 오버레이: 링 리플 + 스프링 체크 + 햅틱 ──
function SuccessOverlay() {
  const circle = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    haptic(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.spring(circle, { toValue: 1, useNativeDriver: true, speed: 11, bounciness: 12 }),
      Animated.spring(check, { toValue: 1, useNativeDriver: true, speed: 13, bounciness: 14 }),
    ]).start();
    Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 1300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      { iterations: 2 },
    ).start();
  }, []);
  return (
    <View style={styles.successOverlay} pointerEvents="none">
      <View style={styles.successCenter}>
        <Animated.View style={[styles.ring, {
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.7] }) }],
        }]} />
        <Animated.View style={[styles.successCircle, { transform: [{ scale: circle }] }]}>
          <Animated.Text style={[styles.checkMark, {
            opacity: check,
            transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
          }]}>✓</Animated.Text>
        </Animated.View>
        <Animated.Text style={[styles.successText, { opacity: check }]}>인식 완료</Animated.Text>
      </View>
    </View>
  );
}

// ── 문제 카드: 가벼운 흔들림 ──
function Shake({ children }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    haptic(Haptics.NotificationFeedbackType.Warning);
    Animated.sequence([-8, 7, -5, 4, 0].map((v) =>
      Animated.timing(x, { toValue: v, duration: 55, useNativeDriver: true }))).start();
  }, []);
  return <Animated.View style={{ transform: [{ translateX: x }] }}>{children}</Animated.View>;
}

export default function App() {
  const [mode, setMode] = useState('idle'); // idle | analyzing | success | result | problem
  const [image, setImage] = useState(null);
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState('');
  const [provider, setProvider] = useState('openai'); // 세그먼트 선택
  const [history, setHistory] = useState([]); // 앱 켜져있는 동안의 인식 이력(메모리)

  const titleOf = (json) => {
    const r = json.receipts?.[0];
    if (!r) return '결과 없음';
    if (r.merchant) return r.total != null ? `${r.merchant} · ${r.total.toLocaleString()}원` : r.merchant;
    if (r.total != null) return `${r.total.toLocaleString()}원`;
    return r.raw_text ? '텍스트' : '결과 없음';
  };
  const addHistory = (partial) => setHistory((h) => [{
    id: Date.now(),
    time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    providerLabel: labelOf(provider),
    ...partial,
  }, ...h].slice(0, 50));

  async function scan() {
    setProblem('');
    let uri;
    try {
      const { scannedImages } = await DocumentScanner.scanDocument({ maxNumDocuments: 1 });
      if (!scannedImages?.length) return; // 사용자 취소
      uri = scannedImages[0];
    } catch {
      const picked = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
      if (picked.canceled) return;
      uri = picked.assets[0].uri;
    }

    const shot = await ImageManipulator.manipulateAsync(
      uri, [{ resize: { width: 1600 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
    );
    setImage(shot.uri);
    setMode('analyzing');

    try {
      const form = new FormData();
      form.append('file', { uri: shot.uri, name: 'receipt.jpg', type: 'image/jpeg' });
      form.append('provider', provider);
      const res = await fetch(API_URL, { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `서버 오류 (HTTP ${res.status})`);
      setResult(json);
      addHistory({
        model: json.model, ms: json.latency_ms,
        cost: json.cost_usd,
        tokens: json.input_tokens != null ? json.input_tokens + (json.output_tokens ?? 0) : null,
        status: json.needs_retake ? 'retake' : 'ok',
        title: json.needs_retake ? '재촬영 필요' : titleOf(json),
      });
      if (json.needs_retake) {
        setProblem('흐리거나 상호·날짜·총액이 안 보입니다. 다시 촬영해주세요.');
        setMode('problem');
      } else {
        setMode('success');                       // 체크 애니메이션
        setTimeout(() => setMode('result'), 1250); // → 자동으로 결과 화면
      }
    } catch (e) {
      addHistory({ model: null, ms: null, status: 'fail', title: (e.message ?? String(e)).split('\n')[0] });
      setProblem(`서버에 연결하지 못했습니다.\n${e.message ?? e}`);
      setMode('problem');
    }
  }

  const busy = mode === 'analyzing' || mode === 'success'; // 스캔 진행 중(세그먼트·CTA 잠금)
  const totalsMatch = result?.receipts?.some((r) => r.total_matches_items);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#EFEEE8', C.bg]} style={StyleSheet.absoluteFill} />

      {/* 헤더 */}
      <FadeInUp style={styles.header}>
        <Text style={styles.kicker}>RECEIPT AI</Text>
        <Text style={styles.title}>영수증 스캔</Text>
        <Text style={styles.sub}>자동 촬영 · 품질 검사 · 즉시 인식</Text>
      </FadeInUp>

      {/* 프로바이더 세그먼트 — 가로 스크롤 (분석 중엔 잠금) */}
      {!busy && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={styles.segScroll} contentContainerStyle={styles.segment}>
          {PROVIDERS.map((p) => {
            const on = provider === p.key;
            return (
              <Pressable key={p.key} onPress={() => setProvider(p.key)} style={[styles.segItem, on && styles.segItemOn]}>
                <Text style={[styles.segText, on && styles.segTextOn]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {mode === 'result' && result && (
          <FadeInUp>
            <View style={styles.metricBar}>
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: C.accentDeep }]}>
                  {(labelOf(result.provider) || '엔진').toUpperCase()}
                </Text>
                <Text style={styles.metricValue} numberOfLines={1}>{result.model || result.provider}</Text>
              </View>
              <View style={styles.metricDiv} />
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>응답속도</Text>
                <Text style={styles.metricValue}>{result.latency_ms != null ? `${result.latency_ms}ms` : '—'}</Text>
              </View>
              <View style={styles.metricDiv} />
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>합계검증</Text>
                <Text style={[styles.metricValue, { color: totalsMatch ? C.accentDeep : C.warn }]}>
                  {totalsMatch ? '일치' : '확인'}
                </Text>
              </View>
            </View>
            <View style={styles.costLine}>
              <Text style={styles.costTok}>
                {result.input_tokens != null
                  ? `토큰 입력 ${fmt(result.input_tokens)} · 출력 ${fmt(result.output_tokens)}`
                  : '페이지 과금 (토큰 없음)'}
              </Text>
              <Text style={styles.costUsd}>
                {result.cost_usd != null
                  ? `≈ $${result.cost_usd.toFixed(4)} · ₩${fmt(result.cost_krw)}`
                  : '—'}
              </Text>
            </View>
          </FadeInUp>
        )}
        {mode === 'idle' && (
          <FadeInUp delay={120}>
            <View style={styles.frame}>
              {['tl', 'tr', 'bl', 'br'].map((c) => <View key={c} style={[styles.corner, styles[c]]} />)}
              <ScanLine height={300} />
              <Text style={styles.frameHint}>영수증을 프레임에 맞춰{'\n'}촬영하면 자동으로 인식됩니다</Text>
            </View>
          </FadeInUp>
        )}

        {(mode === 'analyzing' || mode === 'success') && image && (
          <View style={styles.frame}>
            <Image source={{ uri: image }} style={styles.shot} resizeMode="cover" />
            {mode === 'analyzing' && (
              <>
                <View style={styles.shotScrim} />
                <ScanLine height={300} />
                <View style={styles.analyzingPill}>
                  <Text style={styles.analyzingText}>분석 중…</Text>
                </View>
              </>
            )}
            {mode === 'success' && <SuccessOverlay />}
          </View>
        )}

        {mode === 'result' && result?.receipts?.map((r, i) => {
          const isText = !r.merchant && r.total == null && !r.items?.length;
          return (
            <FadeInUp key={i} delay={i * 110}>
              <View style={styles.card}>
                {isText ? (
                  <>
                    <View style={styles.cardTop}>
                      <Text style={styles.merchant}>인식된 텍스트</Text>
                      <View style={[styles.badge, styles.badgeOk]}>
                        <Text style={[styles.badgeText, { color: C.accentDeep }]}>TEXT</Text>
                      </View>
                    </View>
                    <Text style={styles.rawText}>{r.raw_text || '—'}</Text>
                  </>
                ) : (
                  <>
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.merchant}>{r.merchant || '상호 미상'}</Text>
                        <Text style={styles.date}>
                          {r.date || '날짜 미상'}
                          {r.fields_found != null && `  ·  필드 ${r.fields_found}/${r.fields_total}`}
                        </Text>
                      </View>
                      <View style={[styles.badge, r.total_matches_items ? styles.badgeOk : styles.badgeWarn]}>
                        <Text style={[styles.badgeText, { color: r.total_matches_items ? C.accentDeep : C.warn }]}>
                          {r.total_matches_items ? '합계 일치' : '합계 확인'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>총액</Text>
                      <Text style={styles.totalValue}>
                        {fmt(r.total)}
                        <Text style={styles.currency}> {r.currency || 'KRW'}</Text>
                      </Text>
                    </View>

                    {r.items?.length > 0 ? (
                      <View style={styles.items}>
                        <View style={[styles.irow, styles.ihead]}>
                          <Text style={[styles.iname, styles.ihk]}>품목 {r.items.length}</Text>
                          <Text style={[styles.iqty, styles.ihk]}>수량</Text>
                          <Text style={[styles.iamt, styles.ihk]}>금액</Text>
                        </View>
                        {r.items.map((it, j) => (
                          <View key={j} style={styles.irow}>
                            <Text style={styles.iname} numberOfLines={2}>{it.name || '—'}</Text>
                            <Text style={styles.iqty}>{it.quantity ?? '—'}</Text>
                            <Text style={styles.iamt}>{fmt(it.amount)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : r.raw_text ? (
                      <View style={styles.items}>
                        <Text style={[styles.ihk, { marginBottom: 6 }]}>원문 텍스트</Text>
                        <Text style={styles.rawText}>{r.raw_text}</Text>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </FadeInUp>
          );
        })}

        {mode === 'problem' && (
          <Shake>
            <View style={[styles.card, styles.problemCard]}>
              <Text style={styles.problemIcon}>⚠</Text>
              <Text style={styles.problemText}>{problem}</Text>
            </View>
          </Shake>
        )}

        {history.length > 0 && (
          <FadeInUp>
            <View style={styles.histWrap}>
              <Text style={styles.histHead}>인식 이력 · {history.length}</Text>
              {history.map((h, idx) => (
                <View key={h.id} style={[styles.histRow, idx > 0 && styles.histDivider]}>
                  <View style={[styles.histDot,
                    h.status === 'ok' ? styles.dotOk : h.status === 'retake' ? styles.dotWarn : styles.dotFail]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histModel} numberOfLines={1}>
                      {h.providerLabel}{h.model ? ` · ${h.model}` : ''}
                    </Text>
                    <Text style={styles.histSub} numberOfLines={1}>{h.time} · {h.title}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.histMs}>{h.ms != null ? `${(h.ms / 1000).toFixed(1)}s` : '—'}</Text>
                    <Text style={styles.histCost}>
                      {h.cost != null ? `$${h.cost.toFixed(4)}` : h.tokens ? `${fmt(h.tokens)} tok` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </FadeInUp>
        )}
      </ScrollView>

      {/* 하단 CTA */}
      {!busy && (
        <View style={styles.footer}>
          <PrimaryButton
            label={mode === 'result' ? '다음 영수증 스캔' : mode === 'problem' ? '다시 촬영' : '영수증 스캔'}
            onPress={scan}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 2, color: C.accentDeep, marginBottom: 6 },
  title: { fontSize: 34, fontWeight: '800', color: C.ink, letterSpacing: -0.8 },
  sub: { fontSize: 14, color: C.muted, marginTop: 4 },

  body: { padding: 24, paddingTop: 12, gap: 14 },

  segScroll: { flexGrow: 0, flexShrink: 0, height: 52, marginTop: 4 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  segItem: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 11, backgroundColor: '#ECEAE3' },
  segItemOn: {
    backgroundColor: C.ink,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  segText: { fontSize: 13, fontWeight: '700', color: C.muted, letterSpacing: -0.2 },
  segTextOn: { color: '#fff' },

  metricBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 16, borderWidth: 1, borderColor: C.line, paddingVertical: 14,
  },
  metric: { flex: 1, alignItems: 'center' },
  metricDiv: { width: 1, height: 30, backgroundColor: C.line },
  metricLabel: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.3, marginBottom: 4 },
  metricValue: { fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  costLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingHorizontal: 4 },
  costTok: { fontSize: 12.5, color: C.muted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  costUsd: { fontSize: 13, color: C.accentDeep, fontWeight: '800', fontVariant: ['tabular-nums'] },

  frame: {
    height: 300, borderRadius: 24, backgroundColor: C.surface, overflow: 'hidden',
    borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: C.accent },
  tl: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  tr: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bl: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  br: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  frameHint: { textAlign: 'center', color: C.muted, fontSize: 15, lineHeight: 22, paddingHorizontal: 24 },

  shot: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  shotScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(23,19,14,0.28)' },
  analyzingPill: {
    position: 'absolute', bottom: 16, paddingHorizontal: 18, paddingVertical: 9,
    borderRadius: 20, backgroundColor: 'rgba(23,19,14,0.72)',
  },
  analyzingText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },

  successOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.scrim, alignItems: 'center', justifyContent: 'center' },
  successCenter: { alignItems: 'center' },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: C.accent, top: 0 },
  successCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.accentDeep, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
  },
  checkMark: { color: '#fff', fontSize: 52, fontWeight: '900', marginTop: -4 },
  successText: { marginTop: 18, fontSize: 18, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },

  card: {
    backgroundColor: C.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: C.line,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  merchant: { fontSize: 21, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  date: { fontSize: 14, color: C.muted, marginTop: 3 },
  badge: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  badgeOk: { backgroundColor: C.accentSoft }, badgeWarn: { backgroundColor: C.warnSoft },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },

  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18 },
  totalLabel: { fontSize: 15, color: C.muted, fontWeight: '600' },
  totalValue: { fontSize: 30, fontWeight: '800', color: C.ink, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  currency: { fontSize: 15, fontWeight: '700', color: C.muted, letterSpacing: 0 },

  items: { marginTop: 18, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12, gap: 9 },
  irow: { flexDirection: 'row', alignItems: 'flex-start' },
  ihead: { borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 8, marginBottom: 2 },
  ihk: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  iname: { flex: 1, paddingRight: 10, color: C.ink, fontSize: 15 },
  iqty: { width: 44, textAlign: 'right', color: C.muted, fontSize: 15 },
  iamt: { width: 88, textAlign: 'right', fontWeight: '700', color: C.ink, fontSize: 15, fontVariant: ['tabular-nums'] },

  rawText: { marginTop: 12, color: '#3D3833', fontSize: 14, lineHeight: 22, fontFamily: 'Menlo' },

  problemCard: { backgroundColor: C.warnSoft, borderColor: '#F3D9C6', alignItems: 'center', paddingVertical: 28 },
  problemIcon: { fontSize: 34, marginBottom: 10 },
  problemText: { textAlign: 'center', color: '#9A4A1B', fontSize: 16, fontWeight: '600', lineHeight: 24 },

  histWrap: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, paddingVertical: 14 },
  histHead: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: C.muted, marginBottom: 6 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  histDivider: { borderTopWidth: 1, borderTopColor: C.line },
  histDot: { width: 9, height: 9, borderRadius: 5 },
  dotOk: { backgroundColor: C.accent }, dotWarn: { backgroundColor: C.warn }, dotFail: { backgroundColor: '#C0392B' },
  histModel: { fontSize: 14, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  histSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  histMs: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  histCost: { fontSize: 11.5, color: C.accentDeep, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },

  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 14 },
  btnShadow: { borderRadius: 18, shadowColor: C.accentDeep, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } },
  btn: { paddingVertical: 18, borderRadius: 18, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
});
