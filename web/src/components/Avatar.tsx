import type { Bucket } from '../lib/types.ts';

export function Avatar({
  initial,
  bucket,
  stacked = false,
  title,
}: {
  initial: string;
  bucket: Bucket;
  stacked?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`avatar${stacked ? ' avatar--stacked' : ''}`}
      data-bucket={bucket}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {initial}
    </span>
  );
}

/** 두 사람을 겹쳐 보여준다 — "같이" 배지와 상단 표시에 쓴다. */
export function AvatarPair({
  mine,
  partner,
  label,
}: {
  mine: string;
  partner?: string | null;
  label?: string;
}) {
  return (
    <span className="avatar-pair">
      <Avatar initial={mine} bucket="mine" />
      {partner ? <Avatar initial={partner} bucket="partner" stacked /> : null}
      {label ? <span className="avatar-pair__label">{label}</span> : null}
    </span>
  );
}
