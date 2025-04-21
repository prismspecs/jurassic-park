## Dependencies

Linux

```
sudo apt install espeak     # probably not necessary if using piper
pip install piper-tts       # linux only
sudo apt install v4l-utils  # for OSBOT PITZ camera controls
sudo apt install v4l2loopback-dkms v4l2loopback-utils   # for virtual cameras
```

Mac
Install [uvc-util](https://github.com/jtfrey/uvc-util)

## Camera Setup

All cameras are virtual by default on MacOS. On Linux we have to set this up manually or use something like OBS Studio.

In order to set up virtual cameras run v4l2loopback being sure to use IDs (video_nr) which are not already in use (or simply omit them).

```
sudo modprobe v4l2loopback devices=2 video_nr=10,11 card_label="VirtualCam10","VirtualCam11" exclusive_caps=1

```

Then to stream /dev/video2 into virtual cam 10,

```
gst-launch-1.0 v4l2src device=/dev/video2 ! videoconvert ! videoscale ! \
video/x-raw,width=1920,height=1080 ! v4l2sink device=/dev/video10
```

```
v4l2-ctl --list-devices
```

### Linux

To identify which camera is the OSBOT

```
for i in /dev/video*; do
  echo -n "$i: ";
  v4l2-ctl --device="$i" --info 2>/dev/null | grep -i obsbot
done
```

Find the device. It will expose 2 video interfaces, one which lists the camera controls but all controls and the video feed are on the other interface. In my case, /dev/video2.

```
v4l2-ctl --device=/dev/video2 --list-ctrls
v4l2-ctl --device=/dev/video3 --list-ctrls
```

Test the device

```
v4l2-ctl --device=/dev/video2 --set-ctrl=pan_absolute=0
```

### MacOS

Install [uvc-util](https://github.com/jtfrey/uvc-util)

Testing

```
./uvc-util --list-devices
./uvc-util -I 0 -s pan-tilt-abs="{-3600, 36000}"
./uvc-util -I 0 -s zoom-abs=50
./uvc-util -I 0 -c # show controls
```

## Database

- database
  - scenes
    - 001 - see dinosaurs
      - movie.mp4
      - thumbnail.jpg
      - A - shot description
        - shot.mp4
        - thumbnail.jpg
      - B - ...
      - C - ...
      - D - ...
    - 002 - run from dinosaurs
      - A - shot description
      - B - ...
      - C - ...

## shots.json

The notation for directions:
_this is an action_ such as: _you look at Dr. Grant_
_this is a line of dialogue_ such as _It's... it's a dinosar_

## Process for each scene

- Call actors to the stage
  ...
- ## Action
