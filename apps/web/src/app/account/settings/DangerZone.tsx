import { deleteAccountAction } from './delete-account.js';

export function DangerZone() {
  return (
    <section>
      <h2>Danger zone</h2>
      <p>
        Deleting your account removes your profile, sessions, and GitHub link. Your points
        ledger and audit history stay attributed to an anonymised account so other members&apos;
        rankings are unaffected. This cannot be undone.
      </p>
      <p>Download a copy of your data first if you want to keep it.</p>
      <a href="/account/export" download>Download account data</a>
      <form action={deleteAccountAction}>
        <label>
          <input type="checkbox" name="confirmDeletion" required />
          I understand this permanently deletes my account.
        </label>
        <button type="submit">Delete account</button>
      </form>
    </section>
  );
}
