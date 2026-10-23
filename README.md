# Family Tree

A private family tree website that runs on your own computer at home. You add people, link them
as parents, children, partners or siblings, give each person a profile with photos and a bio,
and look at the tree in four layouts. Everyone you invite signs in with their own username and
password, and you choose what each person may do (read, add, edit, delete).

Nothing is on the internet. The app is reached only over Tailscale (a private network between
your own devices). Photos and backups are kept on your NAS, and the database stays on the VM's own disk.

---

## What you need

- A Linux VM (or computer) at home with **Docker** and **Docker Compose** installed, and this folder on it.
- A **NAS share** you can mount on that VM (NFS or SMB).
- **Tailscale** on the VM and on the phones and computers that will use the app.

You type commands into a terminal on the VM. Everything below is copy and paste; change only the
parts written in capitals or like `192.168.1.10`.

---

## 1. First-time setup

1. Open a terminal in this folder (the one containing `docker-compose.yml`).
2. Copy the settings file:

   ```
   cp .env.example .env
   ```

3. Open `.env` in a text editor (for example `nano .env`) and set:

   | Setting | What to put |
   |---|---|
   | `NAS_MOUNT` | The folder where the NAS will be mounted on the VM, for example `/mnt/nas/family-tree` (step 2) |
   | `TIMEZONE` | Your time zone, for example `Australia/Sydney`. Backups run at the times you choose in this time zone |
   | `BIND_ADDRESS` | Leave as `127.0.0.1` (this VM only) if you will use `tailscale serve` (step 4). See the note there for the alternative |
   | `COOKIE_SECURE` | `true` if you will open the app through the `https://` address from step 4. Otherwise `false` |
   | `PUID`, `PGID` | Leave `1000` unless the NAS refuses to let the app write (see "Permissions" below) |

   Save the file. The `.env` file is private to this VM; do not share it.

---

## 2. Connect the NAS

The app keeps **photos** and **backups** on the NAS so they are safe even if the VM is lost.

### 2a. Make the folders on the NAS

On the NAS, create one shared folder (for example `family-tree`) and make a user that can read and write it.

### 2b. Mount it on the VM

Pick **one** of the two ways. Replace `192.168.1.10` with your NAS address and the share name with yours.

**NFS** (the usual choice for Linux, Synology and TrueNAS). Install the helper once: `sudo apt install nfs-common`.
Add this line at the end of the file `/etc/fstab` (`sudo nano /etc/fstab`):

```
192.168.1.10:/volume1/family-tree  /mnt/nas/family-tree  nfs  defaults,_netdev,nofail,x-systemd.automount,x-systemd.mount-timeout=30  0  0
```

**SMB / Windows sharing.** Install the helper once: `sudo apt install cifs-utils`.
Put the NAS user and password in a private file:

```
sudo sh -c 'printf "username=NASUSER\npassword=NASPASSWORD\n" > /root/.nas-credentials'
sudo chmod 600 /root/.nas-credentials
```

Then add this line to `/etc/fstab`:

```
//192.168.1.10/family-tree  /mnt/nas/family-tree  cifs  credentials=/root/.nas-credentials,uid=1000,gid=1000,file_mode=0660,dir_mode=0770,_netdev,nofail,x-systemd.automount,x-systemd.mount-timeout=30  0  0
```

What the odd words mean: `nofail` lets the VM start even if the NAS is off. `_netdev` waits for the network.
`x-systemd.automount` mounts the share the first time something looks at it, which avoids the VM
starting Docker before the NAS is ready.

Now create the mount folder and mount it:

```
sudo mkdir -p /mnt/nas/family-tree
sudo systemctl daemon-reload
sudo mount /mnt/nas/family-tree
```

### 2c. Create the three things the app looks for

With the share mounted, run these (use your own folder if different):

```
mkdir /mnt/nas/family-tree/photos
mkdir /mnt/nas/family-tree/backups
touch /mnt/nas/family-tree/.family-tree-nas-ok
```

The empty file `.family-tree-nas-ok` is a safety marker. When the app starts it checks for it. If it
is missing, the NAS is probably not mounted and the folders are just empty folders on the VM's disk.
The app then switches photos and backups **off** (showing the "NAS offline" warning) rather than
quietly saving them in the wrong place where they would vanish when the NAS comes back.

### Permissions (only if saving fails)

The app does not run as the all-powerful root user. It runs as user number `PUID` and group number
`PGID` from `.env` (default 1000). That user must be allowed to write to the NAS folders.

- **SMB:** the `uid=1000,gid=1000` in the fstab line already makes everything look owned by 1000. Nothing more to do.
- **NFS:** the NAS decides by number. Find the numbers of the NAS user who owns the `family-tree` folder
  (on the NAS: `id USERNAME`) and put them in `PUID` and `PGID`. Or give user 1000 write access on the NAS.

After changing them run `docker compose up -d` again. The database does not depend on these
numbers; it lives in a Docker volume on the VM that any of these users can write to.

---

## 3. Start the app

```
docker compose up -d
```

The first time this builds the app and takes a few minutes. Check that it works:

```
docker compose ps
curl http://127.0.0.1:8000/api/health
```

You should see `healthy` in the first, and `{"status":"ok"}` from the second.
If you changed `APP_PORT`, use that number instead of 8000.

The app restarts by itself when the VM restarts.

---

## 4. Reach it from your other devices (Tailscale)

The app is not open to the internet and you must not forward any port on your router.

**Recommended: `tailscale serve`.** It gives the app a private `https://` address that works on every
device signed in to your Tailscale account, and it lets phones "install" the app to the home screen.

1. In the Tailscale admin website (login.tailscale.com), open the **DNS** page and make sure
   **MagicDNS** and **HTTPS Certificates** are switched on.
2. On the VM run:

   ```
   sudo tailscale serve --bg 8000
   tailscale serve status
   ```

   The status shows an address like `https://family-vm.your-tailnet.ts.net`. That is the app's address.
3. In `.env` set `COOKIE_SECURE=true`, then run `docker compose up -d`.
4. On another device (with Tailscale on) open the address in a browser.

To turn sharing off again: `sudo tailscale serve reset`.

**Alternative: the VM's Tailscale address.** Run `tailscale ip -4` on the VM (it starts with `100.`).
Put that in `.env` as `BIND_ADDRESS=100.x.x.x`, keep `COOKIE_SECURE=false`, run `docker compose up -d`,
and open `http://100.x.x.x:8000`. This works, but it is plain `http` inside your private network and the
phone "install" option is not offered. Never set `BIND_ADDRESS=0.0.0.0`, which would expose it to your whole home network.

---

## 5. First sign-in

1. Open the app's address. The first time it asks you to **Create the first account**.
   Choose a username and a good password (at least 8 characters). This account is the administrator.
2. After this, no one can create an account on their own. There is no public sign-up.

### Adding family members

1. Click **Settings**, then **Users**, then **Add a user**.
2. Give them a username and a first password (tell them privately), and tick what they may do:

   | Permission | Lets them |
   |---|---|
   | Read | See the tree, profiles and photos |
   | Add | Add new people, links and photos |
   | Edit | Change existing people, links and photos |
   | Delete | Remove people, links and photos |

3. You can change a person's permissions or password, or disable them, from the same list.

Signing in is blocked for 15 minutes after 5 wrong tries. Signed-in sessions time out after a number of hours that you can change in Settings.

### Trying it out with sample people (optional)

To see the four layouts before you enter your own family, there is a script that adds a made-up
22-person family. Only do this on a new, empty install (it refuses if people already exist):

```
python3 scripts/seed_sample_family.py --username YOURADMIN --password 'YOURPASSWORD'
```

Add `--url https://your-address` if you are not running it on the VM itself. To remove the sample people
afterwards, delete them one by one from their profile pages, or (on a brand new install only)
restore the empty state with `docker compose down -v` and start again.

---

## 6. Backups

- Backups are saved to the NAS in the `backups` folder, as two files: `family-tree-DATE-TIME.db`
  (the real backup) and `family-tree-DATE-TIME-export.json` (a readable copy of people, relationships and bios, with no passwords).
- Photos are already on the NAS, so they are not copied again.
- **Settings > Backups** lets you choose the times of day (more than one is fine), the days of the week, and
  how many backups to keep (default 14, oldest are deleted). The first run is at 02:00 in your `TIMEZONE`.
- **Back up now** makes one straight away. The page shows when the last backup ran, its size, and whether it worked.
- If the NAS is off, the page shows a warning and the app tries again every 15 minutes until it works.

---

## 7. Restoring a backup

Use this if the database is damaged or someone deleted too much. **Restoring replaces the current
people, links and users with those in the backup**; anything entered after the backup is lost.
Photos are not affected (they are on the NAS).

1. Look at the file names in the NAS `backups` folder and pick the `.db` file you want, for example
   `family-tree-20261024-020000.db`.
2. Stop the app (the restore refuses to run while it is running):

   ```
   docker compose stop
   ```

3. Restore (replace the file name with yours):

   ```
   docker compose run --rm app python -m app.backup restore /backups/family-tree-20261024-020000.db
   ```

   It says `Restored.` when finished. The database it replaced is kept inside the app's data volume
   as `family_tree.db.before-restore`, in case you chose the wrong file.
4. Start the app again:

   ```
   docker compose up -d
   ```

If it says "That file is not a complete family tree backup", nothing was changed; try another file.

---

## 8. Updating

`update.sh` does it for you: it takes a backup first, rebuilds with the newest base system images, restarts the
app and tells you if it is healthy. If the backup fails, it stops without changing anything.

```
./update.sh
```

Important: **`update.sh` does not download new app code.** Put the newer version of this folder on the VM first, however you
received it (if you are not sure, you are probably already up to date). If this folder is a git checkout, `./update.sh --pull`
also does a safe `git pull` before rebuilding.

The libraries the app uses are pinned to exact versions, so an update only changes them when the
`requirements.txt` in the new code says so.

---

## 9. Security notes

- Passwords are stored scrambled (argon2). Photos are only given to signed-in people who have Read permission.
  Uploaded pictures are re-saved, which removes hidden data such as GPS locations.
- The app should only be reachable over Tailscale. Keep Tailscale itself up to date. In the Tailscale admin website you can switch off key expiry for the VM so it does not drop off your network.
- The app checks its own libraries every day against a list of known security problems. If **Settings > Updates and security**
  shows a warning, it means one of the libraries in this version of the app has a published weakness. Press **Check now** to
  re-check. A warning is not an emergency for a private, Tailscale-only app, but it is worth acting on: get a newer version of
  the app code (which updates the pinned libraries) and run `./update.sh`. If the page says the check could not run, it
  usually just means the VM had no internet at that moment.
- Keep the VM's own system updated (`sudo apt update && sudo apt upgrade`).
- Do not share the `.env` file or the `/root/.nas-credentials` file.

---

## 10. Troubleshooting

**The page shows "NAS offline", photos show a placeholder, or backups fail.**
The tree and profiles keep working. Check the NAS is on, then:
```
ls /mnt/nas/family-tree
```
You should see `photos`, `backups` and `.family-tree-nas-ok` (use `ls -a` to see the dot file). If the folder is empty, mount it again
(`sudo mount /mnt/nas/family-tree`). Then **restart the app so it picks the share up again**:
```
docker compose restart
```
If the app will not start and says a "bind source path does not exist", the `photos` or `backups` folder
is missing from `NAS_MOUNT`; do step 2c again.

**Photo uploads say they cannot be saved though the NAS is on.** The app's user cannot write to the folders. See "Permissions" in step 2.

**I forgot the administrator password.** There is no "forgot password" link. If you have a second administrator, they can set a new password
in **Settings > Users**. (So it is a good idea to make a second administrator.) If you have no other administrator, run these
three commands on the VM, putting your own username and new password (at least 8 characters, no quote marks) in:

```
docker compose stop
docker compose run --rm -e NAME=yourusername -e NEWPW='your-new-password' app python -c "import os,sqlite3;from app.security import hash_password as h;c=sqlite3.connect('/data/family_tree.db');n=c.execute('UPDATE User SET password_hash=?,active=1 WHERE username=?',(h(os.environ['NEWPW']),os.environ['NAME'])).rowcount;c.execute('DELETE FROM Session');c.execute('DELETE FROM LoginAttempt');c.commit();print('Updated',n,'user')"
docker compose up -d
```

It should print `Updated 1 user`. (`Updated 0 user` means the username was not found.) Restoring a backup will not help, because passwords are in the backup too.

**"Port is already allocated" or the app will not start.** Something else uses port 8000. In `.env` set `APP_PORT=8010`,
run `docker compose up -d`, and if you use Tailscale sharing run `sudo tailscale serve reset` then `sudo tailscale serve --bg 8010`.

**I cannot sign in over `http://100...`** but can over `https`: make sure `COOKIE_SECURE=false` when you use plain `http`, and `true` when you use the `https` address.

**Something else.** Look at the app's messages: `docker compose logs --tail 50 app`.

---

## 11. Stopping, removing, keeping your data

- Stop the app: `docker compose stop`. Start it: `docker compose up -d`.
- Remove the app but **keep all data**: `docker compose down`. The database (a Docker volume called
  `family-tree_family_tree_data`), the photos and the backups all stay.
- Delete the database too: `docker compose down -v`. **This cannot be undone** (the NAS photos and backups stay,
  and you could restore the latest backup into a new install with step 7).
- To move to a new VM: copy this folder, mount the same NAS share there, run `docker compose up -d` and
  `docker compose stop`, restore the latest backup (step 7), then `docker compose up -d`.
