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
sudo modprobe -r v4l2loopback  # remove existing module

sudo modprobe v4l2loopback devices=2 video_nr=10,11 card_label="Logitech Preview","Logitech Record" exclusive_caps=0  # create 2 virtual devices

v4l2-ctl --list-devices # list the devices to see if everything worked

# OBSCAM to 2 outputs
gst-launch-1.0 -v \
  v4l2src device=/dev/video4 ! \
    image/jpeg,width=3840,height=2160,framerate=30/1 ! \
    jpegdec ! videoconvert ! \
  tee name=t \
    t. ! queue max-size-buffers=1 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,width=3840,height=2160 ! v4l2sink device=/dev/video10 sync=false \
    t. ! queue max-size-buffers=1 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,width=3840,height=2160 ! v4l2sink device=/dev/video11 sync=false

# record from 1 output

gst-launch-1.0 -e \
  v4l2src device=/dev/video11 ! \
    video/x-raw,framerate=30/1 ! \
    x264enc tune=zerolatency bitrate=8000 speed-preset=ultrafast ! \
    mp4mux ! \
    filesink location=output.mp4

# webcam test
gst-launch-1.0 -v \
  v4l2src device=/dev/video2 ! \
    image/jpeg,width=1920,height=1080,framerate=30/1 ! \
    jpegdec ! videoconvert ! \
    tee name=t \
      t. ! queue max-size-buffers=1 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,width=1920,height=1080 ! v4l2sink device=/dev/video10 sync=false \
      t. ! queue max-size-buffers=1 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,width=1920,height=1080 ! v4l2sink device=/dev/video11 sync=false

# Colorbars test
gst-launch-1.0 videotestsrc ! tee name=t ! queue ! v4l2sink device=/dev/video10 t. ! queue ! v4l2sink device=/dev/video11

```

```
sudo modprobe v4l2loopback devices=2 video_nr=10,11 card_label="Logitech Preview","Logitech Record" exclusive_caps=0
sudo modprobe v4l2loopback devices=1 video_nr=10 card_label="VirtualCam10" exclusive_caps=0
```

Then to stream /dev/video2 into virtual cam 10,

```
gst-launch-1.0 v4l2src device=/dev/video2 ! videoconvert ! videoscale ! \
video/x-raw,width=1920,height=1080 ! v4l2sink device=/dev/video10
```

```
v4l2-ctl --list-devices
```

Some AI advice I just got...

1. Modify v4l2loopback Parameters

Load the module with these specific options:
bash

sudo modprobe -r v4l2loopback # First remove existing module
sudo modprobe v4l2loopback \
 devices=2 \
 video_nr=10,11 \
 card_label="VirtualCam10","VirtualCam11" \
 exclusive_caps=0 \ # Crucial for multiple clients
max_buffers=8 \ # Increased buffer pool
max_openers=3 # Allow multiple simultaneous clients

2. Pipeline Modification for Multi-Output

Use tee to split the stream to both virtual devices:
bash

gst-launch-1.0 \
v4l2src device=/dev/video2 ! \
video/x-raw,format=YUY2,width=1280,height=720 ! \
tee name=streamsplit \
 ! queue ! v4l2sink device=/dev/video10 \
streamsplit. \
 ! queue ! v4l2sink device=/dev/video11

3. Workaround for Single Device Access

If you want to use one virtual device with multiple clients:
bash

gst-launch-1.0 \
v4l2src device=/dev/video2 ! \
videoconvert ! \
video/x-raw,format=YUY2 ! \
v4l2sink device=/dev/video10 \
sync=false async=false \
max-lateness=-1 qos=true

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
