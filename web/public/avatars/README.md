# 아바타 (VRM) 드롭인

이 폴더에 `default.vrm` 파일을 넣으면, 절차적 아바타 대신 **그 VRM 3D 캐릭터**가 렌더링됩니다.
(파일이 없으면 코드 기본값인 절차적 치비 아바타가 자동으로 뜹니다.)

## VRoid Studio로 캐릭터 만들기 (무료)

1. VRoid Studio 설치 (https://vroid.com/studio) — 무료.
2. 얼굴/헤어/의상 커스터마이즈.
3. **내보내기 → VRM 내보내기** → `.vrm` 저장.
4. 그 파일을 `web/public/avatars/default.vrm` 로 복사.
5. 페이지 새로고침 → 3D 캐릭터가 숨쉬고·눈 깜빡이고·표정 짓고·말할 때 입 움직임.

## 감정/표정 매핑
AI가 보낸 감정 태그 → VRM 표준 표정(expression)으로 연결됩니다:
`기쁨→happy, 분노→angry, 슬픔→sad, 편안→relaxed, 놀람/공포→surprised`, 립싱크는 `aa` 비셈, 깜빡임은 `blink`.
VRoid 기본 아바타는 이 표정들을 모두 갖고 있어 바로 동작합니다.

> 여러 캐릭터를 쓰려면 파일명을 나눠 넣고(예: `heroine.vrm`) `avatar.ts`의 로드 경로만 세계/장면별로 바꾸면 됩니다. (다음 단계)
