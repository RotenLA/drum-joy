import type { Language } from "../i18n";
import type { PartId } from "../laneLayouts";

export type TutorialKind = "parts" | "short" | "hold" | "combo" | "done";

export interface TutorialStep {
  kind: TutorialKind;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  targets?: readonly PartId[];
  needed?: number;
}

export const TUTORIAL_STEPS: readonly [TutorialStep, ...TutorialStep[]] = [
  { kind: "parts", titleZh: "认识鼓件", titleEn: "Meet the kit", bodyZh: "依次敲击每个鼓面与踏板，画面上对应的位置会亮起，熟悉一下摆位。", bodyEn: "Strike each pad and pedal in turn; the matching spot lights up so you learn the layout." },
  { kind: "short", titleZh: "军鼓短音符", titleEn: "Snare notes", bodyZh: "四拍预热后跟着下落音符敲军鼓，连续正确 8 次通过。", bodyEn: "After four count-in beats, follow the falling snare notes. Hit 8 correctly in a row.", targets: ["snare"], needed: 8 },
  { kind: "short", titleZh: "底鼓短音符", titleEn: "Kick notes", bodyZh: "跟着下落音符踩右踏板，连续正确 8 次通过。", bodyEn: "Follow the falling notes with the right pedal. Hit 8 correctly in a row.", targets: ["kick"], needed: 8 },
  { kind: "hold", titleZh: "踩住长音符", titleEn: "Hold notes", bodyZh: "长条到达左踏板时踩住不放，直到长条结束。", bodyEn: "Hold the left pedal when the long note arrives, and release after it ends.", targets: ["pedalHat"], needed: 1 },
  { kind: "combo", titleZh: "踩镲与军鼓", titleEn: "Hi-hat and snare", bodyZh: "跟随交替音符敲击踩镲与军鼓，连续正确 8 次通过。", bodyEn: "Alternate between hi-hat and snare for 8 correct hits.", targets: ["hihat", "snare"], needed: 8 },
  { kind: "combo", titleZh: "踏板与踩镲", titleEn: "Pedal and hi-hat", bodyZh: "保持左踏板踩下，同时跟随音符敲击闭镲。", bodyEn: "Keep the left pedal held while following the closed hi-hat notes.", targets: ["pedalHat", "hihat"], needed: 8 },
  { kind: "combo", titleZh: "军鼓与底鼓", titleEn: "Snare and kick", bodyZh: "交替敲击军鼓与底鼓，连续正确 8 次完成组合练习。", bodyEn: "Alternate between snare and kick for 8 correct hits.", targets: ["snare", "kick"], needed: 8 },
  { kind: "done", titleZh: "教学完成", titleEn: "Tutorial complete", bodyZh: "你已经掌握基本演奏方法，现在可以选择歌曲开始游玩。", bodyEn: "You know the basics. Choose a song and start playing." },
];

const STEP_COPY: Partial<Record<Language, readonly { title: string; body: string }[]>> = {
  "zh-TW": [
    { title: "認識鼓件", body: "依次敲擊每個鼓面與踏板，畫面上對應的位置會亮起，熟悉一下擺位。" },
    { title: "軍鼓短音符", body: "四拍預熱後跟著下落音符敲軍鼓，連續正確 8 次通過。" },
    { title: "底鼓短音符", body: "跟著下落音符踩右踏板，連續正確 8 次通過。" },
    { title: "踩住長音符", body: "長條到達左踏板時踩住不放，直到長條結束。" },
    { title: "踩鈸與軍鼓", body: "跟隨交替音符敲擊踩鈸與軍鼓，連續正確 8 次通過。" },
    { title: "踏板與踩鈸", body: "保持左踏板踩下，同時跟隨音符敲擊閉鈸。" },
    { title: "軍鼓與底鼓", body: "交替敲擊軍鼓與底鼓，連續正確 8 次完成組合練習。" },
    { title: "教學完成", body: "你已掌握基本演奏方法，現在可以選擇歌曲開始遊玩。" },
  ],
  ja: [
    { title: "キットを知る", body: "各パッドとペダルを順に叩くと、画面の該当位置が光ります。配置を覚えましょう。" }, { title: "スネアの短いノーツ", body: "4拍のカウント後、落下ノーツに合わせてスネアを8回連続で叩きます。" }, { title: "キックの短いノーツ", body: "落下ノーツに合わせて右ペダルを8回連続で踏みます。" }, { title: "ロングノーツ", body: "長いノーツが左ペダルへ着いたら、終わるまで踏み続けます。" }, { title: "ハイハットとスネア", body: "ハイハットとスネアを交互に8回正しく叩きます。" }, { title: "ペダルとハイハット", body: "左ペダルを踏みながらクローズドハイハットを叩きます。" }, { title: "スネアとキック", body: "スネアとキックを交互に8回正しく演奏します。" }, { title: "チュートリアル完了", body: "基本操作を習得しました。曲を選んでプレイしましょう。" },
  ],
  ko: [
    { title: "드럼 구성 알아보기", body: "각 패드와 페달을 차례로 치면 화면의 해당 위치가 빛납니다. 배치를 익혀 보세요." }, { title: "스네어 짧은 노트", body: "4박 카운트 뒤 떨어지는 노트에 맞춰 스네어를 8번 연속 정확히 치세요." }, { title: "킥 짧은 노트", body: "떨어지는 노트에 맞춰 오른쪽 페달을 8번 연속 정확히 밟으세요." }, { title: "긴 노트 유지", body: "긴 노트가 왼쪽 페달에 도착하면 끝날 때까지 밟고 계세요." }, { title: "하이햇과 스네어", body: "하이햇과 스네어를 번갈아 8번 정확히 연주하세요." }, { title: "페달과 하이햇", body: "왼쪽 페달을 누른 채 닫힌 하이햇을 연주하세요." }, { title: "스네어와 킥", body: "스네어와 킥을 번갈아 8번 정확히 연주하세요." }, { title: "튜토리얼 완료", body: "기본 연주법을 익혔습니다. 곡을 선택해 시작하세요." },
  ],
  fr: [
    { title: "Découvrir la batterie", body: "Frappez chaque pad et pédale : l’emplacement correspondant s’allume à l’écran." }, { title: "Notes courtes de caisse claire", body: "Après quatre temps, frappez correctement 8 notes de caisse claire de suite." }, { title: "Notes courtes de grosse caisse", body: "Suivez les notes avec la pédale droite, 8 fois de suite." }, { title: "Tenir une note longue", body: "Maintenez la pédale gauche quand la note longue arrive, jusqu’à sa fin." }, { title: "Charleston et caisse claire", body: "Alternez charleston et caisse claire pendant 8 frappes correctes." }, { title: "Pédale et charleston", body: "Gardez la pédale gauche enfoncée tout en jouant le charleston fermé." }, { title: "Caisse claire et grosse caisse", body: "Alternez caisse claire et grosse caisse pendant 8 frappes correctes." }, { title: "Tutoriel terminé", body: "Vous connaissez les bases. Choisissez un titre pour jouer." },
  ],
  de: [
    { title: "Drumkit kennenlernen", body: "Schlagen Sie jedes Pad und Pedal an – die passende Stelle leuchtet auf." }, { title: "Kurze Snare-Noten", body: "Spielen Sie nach vier Zählzeiten 8 Snare-Noten in Folge richtig." }, { title: "Kurze Kick-Noten", body: "Folgen Sie den Noten mit dem rechten Pedal, 8-mal in Folge." }, { title: "Lange Note halten", body: "Halten Sie das linke Pedal von Ankunft bis Ende der langen Note gedrückt." }, { title: "Hi-Hat und Snare", body: "Wechseln Sie Hi-Hat und Snare für 8 richtige Treffer ab." }, { title: "Pedal und Hi-Hat", body: "Halten Sie das linke Pedal und spielen Sie die geschlossene Hi-Hat." }, { title: "Snare und Kick", body: "Wechseln Sie Snare und Kick für 8 richtige Treffer ab." }, { title: "Tutorial abgeschlossen", body: "Die Grundlagen sitzen. Wählen Sie einen Song und starten Sie." },
  ],
  it: [
    { title: "Conosci il kit", body: "Colpisci ogni pad e pedale: il punto corrispondente si illumina sullo schermo." }, { title: "Note brevi del rullante", body: "Dopo quattro battiti, esegui correttamente 8 note consecutive sul rullante." }, { title: "Note brevi della cassa", body: "Segui le note con il pedale destro per 8 colpi corretti consecutivi." }, { title: "Tieni la nota lunga", body: "Tieni premuto il pedale sinistro dall’arrivo della nota lunga fino alla fine." }, { title: "Hi-hat e rullante", body: "Alterna hi-hat e rullante per 8 colpi corretti." }, { title: "Pedale e hi-hat", body: "Tieni premuto il pedale sinistro mentre suoni l’hi-hat chiuso." }, { title: "Rullante e cassa", body: "Alterna rullante e cassa per 8 colpi corretti." }, { title: "Tutorial completato", body: "Hai imparato le basi. Scegli un brano e inizia." },
  ],
  es: [
    { title: "Conoce la batería", body: "Toca cada pad y pedal: el punto correspondiente se ilumina en pantalla." }, { title: "Notas cortas de caja", body: "Tras cuatro tiempos, toca correctamente 8 notas seguidas de caja." }, { title: "Notas cortas de bombo", body: "Sigue las notas con el pedal derecho durante 8 golpes correctos." }, { title: "Mantén la nota larga", body: "Mantén pisado el pedal izquierdo desde que llegue la nota larga hasta que termine." }, { title: "Charles y caja", body: "Alterna charles y caja durante 8 golpes correctos." }, { title: "Pedal y charles", body: "Mantén pisado el pedal izquierdo mientras tocas el charles cerrado." }, { title: "Caja y bombo", body: "Alterna caja y bombo durante 8 golpes correctos." }, { title: "Tutorial completado", body: "Ya conoces lo básico. Elige una canción y empieza." },
  ],
};

export function tutorialStepCopy(language: Language, index: number, step: TutorialStep) {
  if (language === "zh-CN") return { title: step.titleZh, body: step.bodyZh };
  if (language === "en") return { title: step.titleEn, body: step.bodyEn };
  return STEP_COPY[language]?.[index] ?? { title: step.titleEn, body: step.bodyEn };
}

export interface TutorialLabels { tutorial: string; leave: string; next: string; retry: string; skip: string; finish: string; complete: string; progress: string; holding: string; stick: string; pedal: string; adapter: string; kitOn?: string; kitOff?: string }
const OTHER: Partial<Record<Language, TutorialLabels>> = {
  "zh-TW": { tutorial: "教學", leave: "離開教學", next: "下一步", retry: "再練一次", skip: "跳過本節", finish: "開始選歌", complete: "完成！", progress: "練習進度", holding: "保持踩住", stick: "鼓棒輸入", pedal: "踏板輸入", adapter: "適配器", kitOn: "鼓聲 開", kitOff: "鼓聲 關" },
  ja: { tutorial: "チュートリアル", leave: "終了", next: "次へ", retry: "もう一度", skip: "スキップ", finish: "曲を選ぶ", complete: "完了！", progress: "進捗", holding: "踏み続ける", stick: "スティック入力", pedal: "ペダル入力", adapter: "アダプター", kitOn: "ドラム音 オン", kitOff: "ドラム音 オフ" },
  ko: { tutorial: "튜토리얼", leave: "나가기", next: "다음", retry: "다시 연습", skip: "건너뛰기", finish: "곡 선택", complete: "완료!", progress: "진행", holding: "계속 누르기", stick: "스틱 입력", pedal: "페달 입력", adapter: "어댑터", kitOn: "드럼 소리 켜기", kitOff: "드럼 소리 끄기" },
  fr: { tutorial: "Tutoriel", leave: "Quitter", next: "Suivant", retry: "Réessayer", skip: "Passer", finish: "Choisir un titre", complete: "Terminé !", progress: "Progression", holding: "Maintenir", stick: "Entrée baguette", pedal: "Entrée pédale", adapter: "Adaptateur", kitOn: "Son batterie on", kitOff: "Son batterie off" },
  de: { tutorial: "Tutorial", leave: "Verlassen", next: "Weiter", retry: "Nochmal", skip: "Überspringen", finish: "Song wählen", complete: "Geschafft!", progress: "Fortschritt", holding: "Gedrückt halten", stick: "Stick-Eingabe", pedal: "Pedal-Eingabe", adapter: "Adapter", kitOn: "Drum-Sound an", kitOff: "Drum-Sound aus" },
  it: { tutorial: "Tutorial", leave: "Esci", next: "Avanti", retry: "Riprova", skip: "Salta", finish: "Scegli brano", complete: "Completato!", progress: "Progresso", holding: "Tieni premuto", stick: "Ingresso bacchetta", pedal: "Ingresso pedale", adapter: "Adattatore", kitOn: "Suono batteria on", kitOff: "Suono batteria off" },
  es: { tutorial: "Tutorial", leave: "Salir", next: "Siguiente", retry: "Repetir", skip: "Saltar", finish: "Elegir canción", complete: "¡Completado!", progress: "Progreso", holding: "Mantén pulsado", stick: "Entrada de baqueta", pedal: "Entrada de pedal", adapter: "Adaptador", kitOn: "Sonido on", kitOff: "Sonido off" },
};

export function tutorialLabels(language: Language): TutorialLabels {
  if (language === "zh-CN") return { tutorial: "教学", leave: "离开教学", next: "下一步", retry: "再练一次", skip: "跳过本节", finish: "开始选歌", complete: "完成！", progress: "练习进度", holding: "保持踩住", stick: "鼓槌输入", pedal: "踏板输入", adapter: "适配器", kitOn: "鼓声 开", kitOff: "鼓声 关" };
  if (language === "en") return { tutorial: "Tutorial", leave: "Leave tutorial", next: "Next", retry: "Try again", skip: "Skip lesson", finish: "Choose a song", complete: "Complete!", progress: "Progress", holding: "Keep holding", stick: "Stick input", pedal: "Pedal input", adapter: "Adapter", kitOn: "Drum sound on", kitOff: "Drum sound off" };
  return OTHER[language] ?? { tutorial: "Tutorial", leave: "Leave tutorial", next: "Next", retry: "Try again", skip: "Skip lesson", finish: "Choose a song", complete: "Complete!", progress: "Progress", holding: "Keep holding", stick: "Stick input", pedal: "Pedal input", adapter: "Adapter", kitOn: "Drum sound on", kitOff: "Drum sound off" };
}