// 2026-10-21時点の調査候補。提供・契約済みを意味しない。
// Jリーグ = 2026特別シーズン「ドリブル総数」。海外 = 2025-26「成功ドリブル/90」。
// 定義・年度が異なるため横断的な総合ランキングや成功率への換算は禁止。
const j='https://www.jleague.jp/j1/stats/player/2026/dribble_count/search-list/';
const eu='https://www.statmuse.com/fc/ask/successful-dribbles-per-90-leaders-in-europe-top-five-2026-u23';
export const RESEARCHED_PLAYERS=[
 {key:'jp-yokoyama-2026',name:'横山 夢樹',profileUrl:'https://www.cerezo.jp/team/players/yumeki_yokoyama/',league:'Jリーグ',affiliation:'セレッソ大阪（2026特別シーズン集計時点）',position:'MF',period:'2026特別シーズン',dribbleAttempts:77,successfulPer90:null,source:'Jリーグ公式・ドリブル総数',sourceUrl:j,brandFitReason:'縦への仕掛けと若手としての伸びしろを映像で重点評価。独自スタイルの実地確認は未実施。',tier:'候補'},
 {key:'jp-kaneko-2026',name:'金子 拓郎',league:'Jリーグ',affiliation:'浦和レッズ（2026特別シーズン集計時点）',position:'MF',period:'2026特別シーズン',dribbleAttempts:80,successfulPer90:null,source:'Jリーグ公式・ドリブル総数',sourceUrl:j,brandFitReason:'積極的な仕掛けの量が多い。ブランドとの適合は映像とSNSで確認。',tier:'候補'},
 {key:'jp-sato-2026',name:'佐藤 龍之介',league:'Jリーグ',affiliation:'FC東京（2026特別シーズン集計時点）',position:'MF',period:'2026特別シーズン',dribbleAttempts:43,successfulPer90:null,source:'Jリーグ公式・ドリブル総数',sourceUrl:j,brandFitReason:'若手の創造性、技術の表現力とSNSでの発信姿勢を要確認。',tier:'候補'},
 {key:'jp-tsukui-2026',name:'津久井 匠海',league:'Jリーグ',affiliation:'ジェフユナイテッド千葉（2026特別シーズン集計時点）',position:'MF',period:'2026特別シーズン',dribbleAttempts:49,successfulPer90:null,source:'Jリーグ公式・ドリブル総数',sourceUrl:j,brandFitReason:'トライ回数の多い攻撃型候補。フェイントの種類は映像確認が必要。',tier:'候補'},
 {key:'eu-diomande-202526',name:'ヤン・ディオマンデ',profileUrl:'https://rbleipzig.com/en/teams/mens/yan-diomande',photoUrl:'https://commons.wikimedia.org/wiki/Special:FilePath/%28Yan_Diomande%29_2026_FIFA_World_Cup%2C_Germany_v_Ivory_Coast_players_%28cropped%29.jpg',photoCredit:'IDontHaveSkype / CC BY 4.0',photoSourceUrl:'https://commons.wikimedia.org/wiki/File:%28Yan_Diomande%29_2026_FIFA_World_Cup%2C_Germany_v_Ivory_Coast_players_%28cropped%29.jpg',league:'海外',affiliation:'RBライプツィヒ（2025-26集計時点）',position:'WG',period:'2025-26',dribbleAttempts:null,successfulPer90:4.19,source:'StatMuse・成功ドリブル/90（U23集計）',sourceUrl:eu,brandFitReason:'若さと1対1の頻度が高い注目候補。実現可能性・代理人・競合スポンサーは未調査。',tier:'候補'},
 {key:'eu-nusa-202526',name:'アントニオ・ヌサ',league:'海外',affiliation:'RBライプツィヒ（2025-26集計時点）',position:'WG',period:'2025-26',dribbleAttempts:null,successfulPer90:3.02,source:'StatMuse・成功ドリブル/90（U23集計）',sourceUrl:eu,brandFitReason:'変化のある仕掛け方を映像評価したい候補。実現性は別評価。',tier:'候補'},
 {key:'eu-yamal-202526',name:'ラミン・ヤマル',photoUrl:'https://commons.wikimedia.org/wiki/Special:FilePath/Lamine_Yamal_in_2025.jpg',photoCredit:'Biso / CC BY 4.0',photoSourceUrl:'https://commons.wikimedia.org/wiki/File:Lamine_Yamal_in_2025.jpg',league:'海外',affiliation:'バルセロナ（2025-26集計時点）',position:'WG',period:'2025-26',dribbleAttempts:null,successfulPer90:5.05,source:'StatMuse・成功ドリブル/90（U23集計）',sourceUrl:eu,brandFitReason:'ブランド表現の比較対象。交渉可能という意味ではない。',tier:'憧れ枠'},
 {key:'eu-doku-202526',name:'ジェレミー・ドク',league:'海外',affiliation:'マンチェスター・シティ（2025-26集計時点）',position:'WG',period:'2025-26',dribbleAttempts:null,successfulPer90:3.89,source:'StatMuse・成功ドリブル/90（U23集計）',sourceUrl:eu,brandFitReason:'スピードと多彩な1対1を研究する比較対象。提供先決定や交渉実績ではない。',tier:'憧れ枠'}
];
export function toCandidate(x){
 return {name:x.name,league:x.league,tier:x.tier,affiliation:x.affiliation,position:x.position,
 profileUrl:x.profileUrl||'',videoUrl:'',photoUrl:x.photoUrl||'',photoCredit:x.photoCredit||'',photoSourceUrl:x.photoSourceUrl||'',dribbleAttempts:x.dribbleAttempts,
 successRate:null,successfulPer90:x.successfulPer90,feintCount:null,playTimeMin:null,
 period:x.period,source:x.source,sourceUrl:x.sourceUrl,
 brandFitReason:x.brandFitReason,confirmItems:'試合映像でフェイントの種類・スタイル・SNS発信、連絡先・契約費・競合スポンサー・写真利用許諾を確認。',
 negotiationStatus:'未接触'};
}
