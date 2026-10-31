import type { EpubMetadataChecks } from '../../types/epub';
import { LoiCheckRow } from './epub-check-ui';

export default function EpubLoiCheck({ checks }: { checks: EpubMetadataChecks }) {
  return <section className="panel check-page-panel">
    <h2 className="check-page-title">이미지 목차</h2>
    <LoiCheckRow label="링크 및 누락 확인" value={checks.loiItems} />
    <LoiCheckRow label="중복 확인" value={checks.loiImageDuplicates} />
    <LoiCheckRow label="연결 확인" value={checks.loiImageNumbers} />
  </section>;
}
