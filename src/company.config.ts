import type { LocalizedText } from "./i18n";
import type { WorkflowStatus } from "./game/workflow";

/**
 * 제품명·화면 문구·색은 이 파일에서만 관리합니다.
 * 다섯 언어를 함께 적는 값은 한 언어라도 빠지면 컴파일되지 않습니다.
 * 제품명은 번역하지 않지만, 직원 이름은 직함과 함께 그 언어권에서 쓰는 이름으로 적습니다.
 */
export const COMPANY = {
  name: "Draftroom",
  mark: "DR",
  pageTitle: {
    ko: "Draftroom · 콘텐츠 제작 작업실",
    en: "Draftroom · content production workspace",
    zh: "Draftroom · 内容制作工作室",
    vi: "Draftroom · xưởng sản xuất nội dung",
    id: "Draftroom · ruang kerja produksi konten",
  },
  description: {
    ko: "주제 분석부터 아이디어 승인과 대본 저장까지 이어지는 로컬 콘텐츠 제작 작업실",
    en: "A local content workspace that runs from topic analysis through idea approval to saving the script",
    zh: "从主题分析到创意审批，再到保存脚本的本地内容制作工作室",
    vi: "Không gian làm việc nội dung cục bộ, từ phân tích chủ đề đến duyệt ý tưởng và lưu kịch bản",
    id: "Ruang kerja konten lokal, dari analisis topik hingga persetujuan ide dan penyimpanan naskah",
  },
  tagline: {
    ko: "주제에서 아이디어와 대본까지, 실제 작업 흐름을 한곳에서 관리합니다.",
    en: "From topic to ideas to script — the real workflow in one place.",
    zh: "从主题到创意再到脚本，真实的工作流集中管理。",
    vi: "Từ chủ đề đến ý tưởng và kịch bản — toàn bộ quy trình thật ở một nơi.",
    id: "Dari topik ke ide hingga naskah — seluruh alur kerja nyata dalam satu tempat.",
  },
} as const satisfies {
  name: string;
  mark: string;
  pageTitle: LocalizedText;
  description: LocalizedText;
  tagline: LocalizedText;
};

/** 화면 색상은 설정에서 CSS 변수로 전달합니다. */
export const THEME = {
  app: "#0b1722",
  frame: "#fffaf0",
  panel: "#eef7f3",
  surface: "#dff1ec",
  line: "#afc9c1",
  edge: "#315f70",
  floor: "#fff0cd",
  cream: "#fffdf5",
  ink: "#102b38",
  muted: "#4a6872",
  skin: "#e0ab84",
  wood: "#b66f3e",
  woodDark: "#694229",
  screen: "#164761",
  green: "#55c985",
  amber: "#f3ad32",
  red: "#c63c47",
  focus: "#176bc1",
  shadow: "#05131c",
} as const;


export const WORKSPACES = [
  {
    id: "briefing",
    code: "01",
    name: { ko: "브리핑룸", en: "Briefing Room", zh: "简报室", vi: "Phòng brief", id: "Ruang Briefing" },
    role: {
      ko: "주제를 목표·대상·핵심 메시지로 정리합니다.",
      en: "Turns the topic into a goal, an audience, and a key message.",
      zh: "把主题梳理成目标、受众和核心信息。",
      vi: "Chuyển chủ đề thành mục tiêu, đối tượng và thông điệp chính.",
      id: "Mengubah topik menjadi tujuan, audiens, dan pesan utama.",
    },
    worker: {
      id: "briefing-coordinator",
      title: { ko: "브리핑 코디네이터", en: "Briefing Coordinator", zh: "简报协调员", vi: "Điều phối brief", id: "Koordinator Briefing" },
      name: { ko: "윤슬", en: "Iris", zh: "妍希", vi: "Ngọc Ánh", id: "Anindya" },
      sprite: 0,
    },
    staff: [
      { id: "operations-manager", title: { ko: "운영 매니저", en: "Operations Manager", zh: "运营经理", vi: "Quản lý vận hành", id: "Manajer Operasional" }, name: { ko: "민서", en: "Naomi", zh: "敏书", vi: "Minh Thư", id: "Melati" }, sprite: 1 },
      { id: "schedule-coordinator", title: { ko: "일정 코디네이터", en: "Schedule Coordinator", zh: "日程协调员", vi: "Điều phối lịch", id: "Koordinator Jadwal" }, name: { ko: "태오", en: "Theo", zh: "泰宇", vi: "Thái Sơn", id: "Bagas" }, sprite: 2 },
      { id: "community-coordinator", title: { ko: "커뮤니티 코디네이터", en: "Community Coordinator", zh: "社区协调员", vi: "Điều phối cộng đồng", id: "Koordinator Komunitas" }, name: { ko: "다온", en: "Dana", zh: "多恩", vi: "Đan Vy", id: "Dian" }, sprite: 3 },
      { id: "office-host", title: { ko: "오피스 호스트", en: "Office Host", zh: "办公室接待", vi: "Lễ tân văn phòng", id: "Host Kantor" }, name: { ko: "루아", en: "Luna", zh: "露雅", vi: "Lan Nhi", id: "Ayu" }, sprite: 4 },
      { id: "briefing-assistant", title: { ko: "브리핑 어시스턴트", en: "Briefing Assistant", zh: "简报助理", vi: "Trợ lý brief", id: "Asisten Briefing" }, name: { ko: "서진", en: "Mila", zh: "静宜", vi: "Tuệ Minh", id: "Rendra" }, sprite: 5 },
      { id: "goal-planner", title: { ko: "목표 플래너", en: "Goal Planner", zh: "目标策划", vi: "Hoạch định mục tiêu", id: "Perencana Tujuan" }, name: { ko: "하율", en: "Adrian", zh: "亦辰", vi: "Bảo Ngọc", id: "Nayla" }, sprite: 4 },
    ],
    accent: "#f6b73c",
  },
  {
    id: "research",
    code: "02",
    name: { ko: "독자 분석실", en: "Audience Lab", zh: "受众分析室", vi: "Phòng phân tích khán giả", id: "Lab Audiens" },
    role: {
      ko: "외부 조사 없이 고객 관점 가설을 정리합니다.",
      en: "Frames audience hypotheses without any external research.",
      zh: "不做外部调研，梳理受众视角的假设。",
      vi: "Xây dựng giả thuyết theo góc nhìn khách hàng mà không khảo sát bên ngoài.",
      id: "Menyusun hipotesis sudut pandang audiens tanpa riset eksternal.",
    },
    worker: {
      id: "topic-analyst",
      title: { ko: "주제 분석가", en: "Topic Analyst", zh: "主题分析师", vi: "Phân tích chủ đề", id: "Analis Topik" },
      name: { ko: "도윤", en: "Ethan", zh: "浩然", vi: "Minh Khôi", id: "Arjuna" },
      sprite: 3,
    },
    staff: [
      { id: "trend-researcher", title: { ko: "트렌드 리서처", en: "Trend Researcher", zh: "趋势研究员", vi: "Nghiên cứu xu hướng", id: "Peneliti Tren" }, name: { ko: "수아", en: "Sophie", zh: "思雅", vi: "Thu An", id: "Salsa" }, sprite: 4 },
      { id: "insight-analyst", title: { ko: "인사이트 애널리스트", en: "Insight Analyst", zh: "洞察分析师", vi: "Phân tích insight", id: "Analis Insight" }, name: { ko: "준호", en: "Julian", zh: "俊豪", vi: "Quốc Huy", id: "Rizky" }, sprite: 5 },
      { id: "audience-researcher", title: { ko: "오디언스 리서처", en: "Audience Researcher", zh: "受众研究员", vi: "Nghiên cứu đối tượng", id: "Peneliti Audiens" }, name: { ko: "은호", en: "Owen", zh: "恩浩", vi: "Gia Bảo", id: "Fajar" }, sprite: 0 },
      { id: "data-curator", title: { ko: "데이터 큐레이터", en: "Data Curator", zh: "数据策展人", vi: "Quản lý dữ liệu", id: "Kurator Data" }, name: { ko: "채원", en: "Chloe", zh: "采薇", vi: "Mai Chi", id: "Citra" }, sprite: 2 },
      { id: "survey-planner", title: { ko: "설문 플래너", en: "Survey Planner", zh: "问卷策划", vi: "Hoạch định khảo sát", id: "Perencana Survei" }, name: { ko: "예준", en: "Felix", zh: "逸凡", vi: "Khánh Vy", id: "Bayu" }, sprite: 1 },
      { id: "persona-writer", title: { ko: "페르소나 라이터", en: "Persona Writer", zh: "人物志撰写", vi: "Viết chân dung khách", id: "Penulis Persona" }, name: { ko: "지아", en: "Ivy", zh: "语晴", vi: "Nam Phong", id: "Intan" }, sprite: 0 },
    ],
    accent: "#58b9e8",
  },
  {
    id: "ideas",
    code: "03",
    name: { ko: "아이디어룸", en: "Idea Room", zh: "创意室", vi: "Phòng ý tưởng", id: "Ruang Ide" },
    role: {
      ko: "아이디어 10개와 우선 후보 3개를 만듭니다.",
      en: "Produces 10 ideas and the 3 leading candidates.",
      zh: "产出 10 个创意和 3 个优先候选。",
      vi: "Tạo 10 ý tưởng và 3 phương án ưu tiên.",
      id: "Menghasilkan 10 ide dan 3 kandidat utama.",
    },
    worker: {
      id: "idea-editor",
      title: { ko: "아이디어 에디터", en: "Idea Editor", zh: "创意编辑", vi: "Biên tập ý tưởng", id: "Editor Ide" },
      name: { ko: "세아", en: "Sarah", zh: "世雅", vi: "Bảo Trân", id: "Kirana" },
      sprite: 0,
    },
    staff: [
      { id: "copy-director", title: { ko: "카피 디렉터", en: "Copy Director", zh: "文案总监", vi: "Giám đốc copy", id: "Direktur Copy" }, name: { ko: "나래", en: "Nora", zh: "娜蕾", vi: "Nhã Uyên", id: "Nadia" }, sprite: 1 },
      { id: "format-planner", title: { ko: "포맷 플래너", en: "Format Planner", zh: "形式策划", vi: "Hoạch định format", id: "Perencana Format" }, name: { ko: "시우", en: "Simon", zh: "诗宇", vi: "Trung Kiên", id: "Satria" }, sprite: 2 },
      { id: "concept-designer", title: { ko: "콘셉트 디자이너", en: "Concept Designer", zh: "概念设计师", vi: "Thiết kế concept", id: "Desainer Konsep" }, name: { ko: "예린", en: "Elena", zh: "艺琳", vi: "Diễm Quỳnh", id: "Larasati" }, sprite: 3 },
      { id: "hook-writer", title: { ko: "후크 라이터", en: "Hook Writer", zh: "开场文案", vi: "Viết hook", id: "Penulis Hook" }, name: { ko: "건우", en: "Gavin", zh: "建宇", vi: "Đức Anh", id: "Gilang" }, sprite: 5 },
      { id: "title-writer", title: { ko: "제목 라이터", en: "Title Writer", zh: "标题撰稿", vi: "Viết tiêu đề", id: "Penulis Judul" }, name: { ko: "도하", en: "Leo", zh: "承宇", vi: "Phương Linh", id: "Dimas" }, sprite: 4 },
      { id: "story-planner", title: { ko: "스토리 플래너", en: "Story Planner", zh: "故事策划", vi: "Hoạch định câu chuyện", id: "Perencana Cerita" }, name: { ko: "나윤", en: "Maya", zh: "若曦", vi: "Hữu Nghĩa", id: "Sari" }, sprite: 2 },
    ],
    accent: "#ef71b4",
  },
  {
    id: "studio",
    code: "04",
    name: { ko: "제작 스튜디오", en: "Production Studio", zh: "制作工作室", vi: "Xưởng sản xuất", id: "Studio Produksi" },
    role: {
      ko: "승인된 후보의 릴스·쇼츠·캐러셀 원고를 만듭니다.",
      en: "Drafts the reels, shorts, or carousel copy for the approved pick.",
      zh: "为通过的方案撰写 Reels、Shorts 或轮播文案。",
      vi: "Viết kịch bản Reels, Shorts hoặc carousel cho phương án đã duyệt.",
      id: "Menulis naskah Reels, Shorts, atau carousel untuk pilihan yang disetujui.",
    },
    worker: {
      id: "script-writer",
      title: { ko: "스크립트 라이터", en: "Script Writer", zh: "脚本撰稿", vi: "Viết kịch bản", id: "Penulis Naskah" },
      name: { ko: "지후", en: "Jonah", zh: "智皓", vi: "Hoàng Long", id: "Bimo" },
      sprite: 3,
    },
    staff: [
      { id: "visual-director", title: { ko: "비주얼 디렉터", en: "Visual Director", zh: "视觉总监", vi: "Giám đốc hình ảnh", id: "Direktur Visual" }, name: { ko: "유진", en: "Robin", zh: "悠然", vi: "Thanh Vân", id: "Cahya" }, sprite: 4 },
      { id: "shortform-editor", title: { ko: "숏폼 에디터", en: "Shortform Editor", zh: "短视频剪辑", vi: "Biên tập short-form", id: "Editor Short-form" }, name: { ko: "현우", en: "Wesley", zh: "贤宇", vi: "Tuấn Kiệt", id: "Wisnu" }, sprite: 5 },
      { id: "motion-planner", title: { ko: "모션 플래너", en: "Motion Planner", zh: "动效策划", vi: "Hoạch định motion", id: "Perencana Motion" }, name: { ko: "서윤", en: "Sienna", zh: "舒允", vi: "Thùy Dương", id: "Sekar" }, sprite: 0 },
      { id: "sound-editor", title: { ko: "사운드 에디터", en: "Sound Editor", zh: "声音剪辑", vi: "Biên tập âm thanh", id: "Editor Suara" }, name: { ko: "로한", en: "Rohan", zh: "洛涵", vi: "Hải Đăng", id: "Raka" }, sprite: 2 },
      { id: "caption-writer", title: { ko: "캡션 라이터", en: "Caption Writer", zh: "字幕撰稿", vi: "Viết chú thích", id: "Penulis Keterangan" }, name: { ko: "시온", en: "Noel", zh: "星河", vi: "Kim Ngân", id: "Yoga" }, sprite: 1 },
      { id: "thumbnail-designer", title: { ko: "썸네일 디자이너", en: "Thumbnail Designer", zh: "封面设计师", vi: "Thiết kế ảnh bìa", id: "Desainer Sampul" }, name: { ko: "유하", en: "Ruby", zh: "沐阳", vi: "Duy Anh", id: "Laras" }, sprite: 3 },
    ],
    accent: "#aa8cf2",
  },
  {
    id: "archive",
    code: "05",
    name: { ko: "교정실", en: "Edit Room", zh: "校订室", vi: "Phòng biên tập", id: "Ruang Edit" },
    role: {
      ko: "대본을 최종 편집하고 결과를 파일로 저장합니다.",
      en: "Final-edits the script and saves the result to a file.",
      zh: "完成脚本终稿并把结果保存为文件。",
      vi: "Biên tập cuối kịch bản và lưu kết quả thành tệp.",
      id: "Menyunting akhir naskah dan menyimpan hasilnya sebagai berkas.",
    },
    worker: {
      id: "archive-keeper",
      title: { ko: "최종 교정자", en: "Final Editor", zh: "终稿校订员", vi: "Biên tập viên cuối", id: "Editor Akhir" },
      name: { ko: "하린", en: "Harper", zh: "夏琳", vi: "Hạ Linh", id: "Hasna" },
      sprite: 0,
    },
    staff: [
      { id: "quality-reviewer", title: { ko: "품질 검수자", en: "Quality Reviewer", zh: "质量审校", vi: "Kiểm định chất lượng", id: "Peninjau Kualitas" }, name: { ko: "소연", en: "Sonia", zh: "素妍", vi: "Tố Uyên", id: "Ratna" }, sprite: 1 },
      { id: "publishing-manager", title: { ko: "퍼블리싱 매니저", en: "Publishing Manager", zh: "发布经理", vi: "Quản lý xuất bản", id: "Manajer Publikasi" }, name: { ko: "재민", en: "Jasper", zh: "佳铭", vi: "Tấn Phát", id: "Jaya" }, sprite: 2 },
      { id: "metadata-manager", title: { ko: "메타데이터 매니저", en: "Metadata Manager", zh: "元数据管理", vi: "Quản lý metadata", id: "Manajer Metadata" }, name: { ko: "가온", en: "Casey", zh: "嘉恩", vi: "An Khang", id: "Gita" }, sprite: 3 },
      { id: "release-coordinator", title: { ko: "배포 코디네이터", en: "Release Coordinator", zh: "发布协调员", vi: "Điều phối phát hành", id: "Koordinator Rilis" }, name: { ko: "아린", en: "Aria", zh: "雅琳", vi: "Ái Linh", id: "Arini" }, sprite: 5 },
      { id: "fact-checker", title: { ko: "팩트 체커", en: "Fact Checker", zh: "事实核查员", vi: "Kiểm chứng thông tin", id: "Pemeriksa Fakta" }, name: { ko: "태린", en: "Silas", zh: "佳颖", vi: "Thảo Nhi", id: "Tirta" }, sprite: 4 },
      { id: "archive-librarian", title: { ko: "자료 사서", en: "Archive Librarian", zh: "资料管理员", vi: "Thủ thư tư liệu", id: "Pustakawan Arsip" }, name: { ko: "승우", en: "Vera", zh: "文轩", vi: "Xuân Mai", id: "Wulan" }, sprite: 1 },
    ],
    accent: "#4fc484",
  },
] as const satisfies readonly {
  id: string;
  code: string;
  name: LocalizedText;
  role: LocalizedText;
  worker: { id: string; title: LocalizedText; name: LocalizedText; sprite: number };
  staff: readonly { id: string; title: LocalizedText; name: LocalizedText; sprite: number }[];
  accent: string;
}[];

export type WorkspaceId = (typeof WORKSPACES)[number]["id"];

export const STATUS_LABELS = {
  idle: { ko: "대기", en: "Idle", zh: "待机", vi: "Chờ", id: "Menunggu" },
  running: { ko: "실행 중", en: "Running", zh: "运行中", vi: "Đang chạy", id: "Berjalan" },
  awaiting_approval: { ko: "승인 대기", en: "Awaiting approval", zh: "待审批", vi: "Chờ duyệt", id: "Menunggu persetujuan" },
  completed: { ko: "완료", en: "Done", zh: "完成", vi: "Xong", id: "Selesai" },
  failed: { ko: "실패", en: "Failed", zh: "失败", vi: "Thất bại", id: "Gagal" },
} as const satisfies Record<WorkflowStatus, LocalizedText>;
